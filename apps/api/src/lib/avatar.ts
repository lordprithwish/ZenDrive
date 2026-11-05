import fs from "node:fs/promises"
import { prisma } from "../db/prisma.js"
import { env } from "../env.js"
import { newScratchPath, newStorageKey, storage } from "../storage/index.js"

const MAX_BYTES = 2 * 1024 * 1024
const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}
export const AVATAR_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

// Google's profile-picture CDN rate-limits/blocks hotlinking after a few
// loads, and every page renders avatars straight into <img>. So we fetch the
// picture once at login, keep our own copy in storage, and point avatarUrl at
// our own /api/auth/avatar/:id route. Never throws: a failed mirror must not
// block a login, and the user just keeps whatever avatar they had.
export async function mirrorGoogleAvatar(userId: string, googleUrl?: string | null): Promise<void> {
  if (!googleUrl) return
  const tmp = newScratchPath()
  try {
    const src = new URL(googleUrl)
    // The URL comes from Google's profile, but stay strict: this is a
    // server-side fetch, so only ever talk to Google's image host.
    if (src.protocol !== "https:" || !src.hostname.endsWith(".googleusercontent.com")) return
    // Default is 96px; ask for a sharper copy since we're hosting it ourselves.
    src.pathname = src.pathname.replace(/=s\d+-c$/, "=s256-c")

    const res = await fetch(src, { signal: AbortSignal.timeout(10_000) })
    const ext = EXT[res.headers.get("content-type")?.split(";")[0].trim() ?? ""]
    if (!res.ok || !ext) return
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) return

    await fs.writeFile(tmp, buf)
    const key = newStorageKey(`avatar${ext}`)
    await storage.putFile(key, tmp)

    const old = await prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true } })
    await prisma.user.update({
      where: { id: userId },
      data: {
        avatarKey: key,
        // ?v busts browser caches when the picture changes (route is immutable-cached).
        avatarUrl: `${env.APP_URL.replace(/\/$/, "")}/api/auth/avatar/${userId}?v=${Date.now()}`,
      },
    })
    if (old?.avatarKey) await storage.remove(old.avatarKey).catch(() => {})
  } catch (err) {
    console.error("[avatar] mirror failed:", err)
  } finally {
    await fs.rm(tmp, { force: true })
  }
}
