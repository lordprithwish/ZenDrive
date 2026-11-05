import path from "node:path"
import { Router } from "express"
import { AVATAR_MIME } from "../lib/avatar.js"
import { storage } from "../storage/index.js"
import { z } from "zod"
import { passport } from "../auth/passport.js"
import { env } from "../env.js"
import { currentUser, requireAuth } from "../middleware/auth.js"
import { assertUserPhotosRootId, assertUserRootFolderId, assertUserSyncRootId } from "../lib/access.js"
import { prisma } from "../db/prisma.js"
import { safeReturnUrl } from "../lib/origins.js"

export const authRouter = Router()

// `?return=<origin>` says which frontend to come back to — DarkGallery is a
// separate origin from the drive UI, so without it every gallery sign-in would
// land the user on DarkDrive. It rides along as the OAuth `state` parameter
// rather than in the session, which passport regenerates on login. Untrusted
// on the way back, hence re-validated in the callback.
authRouter.get("/google", (req, res, next) =>
  passport.authenticate("google", {
    scope: ["profile", "email"],
    state: safeReturnUrl(req.query.return) ?? undefined,
  })(req, res, next)
)

authRouter.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: `${env.WEB_URL}/login?error=oauth` }),
  (req, res) => {
    if (req.user) {
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
        req.ip ||
        null
      prisma.loginEvent
        .create({
          data: {
            userId: (req.user as { id: string }).id,
            ip,
            userAgent: req.get("user-agent") ?? null,
          },
        })
        .catch(() => {})
    }
    res.redirect(safeReturnUrl(req.query.state) ?? `${env.WEB_URL}/`)
  }
)

// Password-less login-by-email for local development only. Gated on
// NODE_ENV being exactly "development" (not merely "not production" — a
// "test" environment pointed at real data should never expose this either)
// AND an explicit opt-in flag. The whole block, including the status probe,
// is skipped outside dev so these routes don't exist at all elsewhere — a
// request 404s instead of a status endpoint confirming the feature exists.
if (env.NODE_ENV === "development") {
  const devLoginEnabled = env.ENABLE_DEV_LOGIN

  if (devLoginEnabled) {
    console.warn(
      "[api] DEV LOGIN IS ENABLED — do not point this at a database with real user data"
    )
  }

  authRouter.get("/dev-login/status", (_req, res) => {
    res.json({ enabled: devLoginEnabled })
  })

  if (devLoginEnabled) {
    authRouter.post("/dev-login", async (req, res) => {
      // safeParse, not parse: a thrown ZodError inside an async Express 4
      // handler becomes an unhandled promise rejection (Express 4 doesn't
      // await handlers), which crashes the process under Node's default
      // "throw" unhandled-rejection policy. Handling it inline keeps this
      // route crash-proof regardless of that wider, pre-existing gap.
      const parsed = z
        .object({ email: z.string().trim().toLowerCase().email() })
        .safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid", issues: parsed.error.issues })
      }
      const { email } = parsed.data

      let user = await prisma.user.findUnique({ where: { email } })
      if (!user) {
        user = await prisma.$transaction(async (tx) => {
          // Mirrors the Google OAuth bootstrap: first-ever user becomes ADMIN.
          const isFirst = (await tx.user.count()) === 0
          const created = await tx.user.create({
            data: {
              googleId: `dev-login:${email}`,
              email,
              name: email.split("@")[0],
              role: isFirst ? "ADMIN" : "USER",
            },
          })
          const root = await tx.folder.create({
            data: { name: "My Drive", ownerId: created.id },
          })
          return tx.user.update({ where: { id: created.id }, data: { rootFolderId: root.id } })
        })
      }

      req.login(user, (err) => {
        if (err) return res.status(500).json({ error: "login_failed" })
        res.json({ ok: true })
      })
    })
  }
}

authRouter.post("/logout", (req, res) => {
  // Signing out on the untrusted device ends that temp session for good,
  // same as revoking it from the session list.
  const temp = req.user?.tempSession
  if (temp) prisma.tempSession.deleteMany({ where: { id: temp.id } }).catch(() => {})
  req.logout(() => {
    req.session?.destroy(() => {
      res.clearCookie("dd.sid")
      res.json({ ok: true })
    })
  })
})

// Public on purpose: avatars show up in <img> tags for other members of a
// space/share and on cross-origin frontends. The URL carries ?v=<timestamp>,
// so it is safe to cache forever.
authRouter.get("/avatar/:id", async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { avatarKey: true },
  })
  const s = u?.avatarKey ? await storage.readStream(u.avatarKey) : null
  if (!u?.avatarKey || !s) return res.status(404).end()
  res.setHeader("Content-Type", AVATAR_MIME[path.extname(u.avatarKey)] ?? "image/jpeg")
  res.setHeader("Content-Length", s.size)
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
  s.stream.pipe(res)
})

authRouter.get("/me", requireAuth, async (req, res) => {
  const u = currentUser(req)
  // Every root: "My Photos" and "Synced Folders" are siblings of "My Drive",
  // not children, so the sidebar can't reach them by walking the drive tree.
  const [rootFolderId, photosRootFolderId, syncRootFolderId] = await Promise.all([
    assertUserRootFolderId(u),
    assertUserPhotosRootId(u),
    assertUserSyncRootId(u),
  ])
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    rootFolderId,
    photosRootFolderId,
    syncRootFolderId,
    role: u.role,
    storageQuotaBytes: Number(u.storageQuotaBytes),
    // Non-null only on a temp-session login; the web app shows it and signs
    // the tab out when it passes.
    tempSessionExpiresAt: req.user?.tempSession?.expiresAt ?? null,
  })
})
