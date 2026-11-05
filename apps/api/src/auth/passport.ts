import passport from "passport"
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import { prisma } from "../db/prisma.js"
import { env } from "../env.js"
import { mirrorGoogleAvatar } from "../lib/avatar.js"

// Temp-session logins (routes/tempSessions.ts) serialize as {id, t} instead
// of a bare id, so deserializeUser knows to re-check that session's row.
passport.serializeUser((user: Express.User, done) =>
  done(null, user.tempSession ? { id: user.id, t: user.tempSession.id } : user.id)
)

passport.deserializeUser(async (key: string | { id: string; t: string }, done) => {
  try {
    // A temp session ends the moment its row expires or is deleted. Checked
    // here because this is the one place both HTTP and the socket pass
    // through — and the cookie can't be trusted to expire it (see the
    // TempSession model).
    if (typeof key === "object") {
      const t = await prisma.tempSession.findUnique({
        where: { id: key.t },
        include: { user: true },
      })
      if (!t || t.expiresAt <= new Date() || t.user.disabledAt) return done(null, false)
      // Throttled: one page of thumbnails is dozens of requests.
      if (!t.lastSeenAt || Date.now() - t.lastSeenAt.getTime() > 60_000) {
        prisma.tempSession
          .update({ where: { id: t.id }, data: { lastSeenAt: new Date() } })
          .catch(() => {})
      }
      return done(null, { ...t.user, tempSession: { id: t.id, expiresAt: t.expiresAt } })
    }

    const user = await prisma.user.findUnique({ where: { id: key } })
    // Disabled accounts get treated as logged-out on every request so their
    // active sessions effectively stop working the moment the admin flips the
    // flag.
    if (!user || user.disabledAt) return done(null, false)
    done(null, user)
  } catch (e) {
    done(e as Error)
  }
})

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
    },
    async (_at, _rt, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value
        if (!email) return done(new Error("No email on Google profile"))

        const photo = profile.photos?.[0]?.value
        const existing = await prisma.user.findUnique({ where: { googleId: profile.id } })
        if (existing) {
          // Mirror once; later logins reuse our copy instead of hitting Google
          // again (repeat fetches are what get the link blocked). Only for
          // users still holding the old raw Google URL — someone who removed
          // their photo (avatarUrl null) must not get it re-imported.
          if (existing.avatarUrl && !existing.avatarKey) {
            await mirrorGoogleAvatar(existing.id, photo)
            return done(null, (await prisma.user.findUnique({ where: { id: existing.id } })) ?? existing)
          }
          return done(null, existing)
        }

        const user = await prisma.$transaction(async (tx) => {
          // First-ever user bootstraps as ADMIN so there's no SQL-only escape hatch.
          const isFirst = (await tx.user.count()) === 0
          const u = await tx.user.create({
            data: {
              googleId: profile.id,
              email,
              name: profile.displayName || email,
              role: isFirst ? "ADMIN" : "USER",
            },
          })
          const root = await tx.folder.create({
            data: { name: "My Drive", ownerId: u.id },
          })
          return tx.user.update({ where: { id: u.id }, data: { rootFolderId: root.id } })
        })

        await mirrorGoogleAvatar(user.id, photo)
        done(null, (await prisma.user.findUnique({ where: { id: user.id } })) ?? user)
      } catch (e) {
        done(e as Error)
      }
    }
  )
)

export { passport }
