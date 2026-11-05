import { Router } from "express"
import { z } from "zod"
import { prisma } from "../db/prisma.js"
import { currentUser, denyTempSession, requireAuth } from "../middleware/auth.js"
import { fileCategory, type FileCategory } from "../lib/fileType.js"
import { buildUserDetail } from "../lib/userDetail.js"
import { AVATAR_EXT, clearAvatar, saveAvatar } from "../lib/avatar.js"
import multer from "multer"

declare module "express-session" {
  interface SessionData {
    nav?: { stack: string[]; index: number }
  }
}

export const meRouter = Router()
meRouter.use(requireAuth)

// The profile page: the same lifecycle aggregate the admin drawer shows,
// scoped to whoever is asking.
meRouter.get("/detail", async (req, res) => {
  const data = await buildUserDetail(currentUser(req).id)
  if (!data) return res.status(404).json({ error: "not_found" })
  res.json(data)
})

// Edit-your-profile. Temp sessions are borrowed devices — they can't change
// who the account is.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

meRouter.patch("/profile", denyTempSession, async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: "invalid" })
  const u = await prisma.user.update({
    where: { id: currentUser(req).id },
    data: { name: body.data.name },
    select: { name: true },
  })
  res.json(u)
})

meRouter.post("/avatar", denyTempSession, (req, res) => {
  avatarUpload.single("avatar")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "too_large" : "upload_failed" })
    const ext = AVATAR_EXT[req.file?.mimetype ?? ""]
    if (!req.file || !ext) return res.status(400).json({ error: "only_jpeg_png_webp" })
    try {
      res.json({ avatarUrl: await saveAvatar(currentUser(req).id, req.file.buffer, ext) })
    } catch (e) {
      console.error("[avatar] upload failed:", e)
      res.status(500).json({ error: "save_failed" })
    }
  })
})

meRouter.delete("/avatar", denyTempSession, async (req, res) => {
  await clearAvatar(currentUser(req).id)
  res.json({ ok: true })
})

meRouter.get("/quota", async (req, res) => {
  const user = currentUser(req)
  const files = await prisma.file.findMany({
    where: { ownerId: user.id, isTrashed: false },
    select: { mimeType: true, name: true, size: true },
  })
  const byType: Record<FileCategory, number> = {
    image: 0, video: 0, audio: 0, doc: 0, archive: 0, other: 0,
  }
  const bytesByType: Record<FileCategory, number> = {
    image: 0, video: 0, audio: 0, doc: 0, archive: 0, other: 0,
  }
  let used = 0
  for (const f of files) {
    const sz = Number(f.size)
    used += sz
    const k = fileCategory(f.mimeType, f.name)
    byType[k] += 1
    bytesByType[k] += sz
  }
  res.json({
    used,
    total: Number(user.storageQuotaBytes),
    role: user.role,
    upgradeRequestedAt: user.upgradeRequestedAt,
    upgradeRequestedBytes: user.upgradeRequestedBytes
      ? Number(user.upgradeRequestedBytes)
      : null,
    byType,
    bytesByType,
  })
})

// Backing payload for the storage analyzer (/storage): every file the user is
// charged for, plus their folders so sizes can be rolled up into a tree. Same
// scope as /quota above, so the totals agree.
// ponytail: whole listing in one response — personal-drive scale; paginate if a
// drive ever gets big enough to feel it.
meRouter.get("/storage", async (req, res) => {
  const user = currentUser(req)
  const [files, folders] = await Promise.all([
    prisma.file.findMany({
      where: { ownerId: user.id, isTrashed: false },
      orderBy: { size: "desc" },
    }),
    prisma.folder.findMany({
      where: { ownerId: user.id, isTrashed: false },
      orderBy: { name: "asc" },
    }),
  ])
  res.json({
    files: files.map((f) => ({ ...f, size: Number(f.size) })),
    folders,
    quota: Number(user.storageQuotaBytes),
  })
})

meRouter.post("/request-upgrade", async (req, res) => {
  const user = currentUser(req)
  const { bytes } = z
    .object({
      bytes: z
        .number()
        .int()
        .positive()
        .max(10 * 1024 ** 4), // 10 TiB cap
    })
    .parse(req.body)
  if (BigInt(bytes) <= user.storageQuotaBytes)
    return res.status(400).json({ error: "must_exceed_current_quota" })
  await prisma.user.update({
    where: { id: user.id },
    data: {
      upgradeRequestedAt: new Date(),
      upgradeRequestedBytes: BigInt(bytes),
    },
  })
  res.json({ ok: true })
})

// Directory search used by the invite autocomplete. Casts a wider net than a
// strict `contains` so the client's fuzzy matcher has something to work with
// on typos (e.g. "jhon" still surfaces users whose name starts with "jh").
// Requires at least 2 chars so we don't hand out the entire user directory.
meRouter.get("/user-search", async (req, res) => {
  const user = currentUser(req)
  const q = String(req.query.q ?? "").trim()
  const limit = Math.min(
    parseInt(String(req.query.limit ?? "30"), 10) || 30,
    50
  )
  if (q.length < 2) return res.json({ users: [] })
  const head = q.slice(0, 2)
  const users = await prisma.user.findMany({
    where: {
      id: { not: user.id },
      disabledAt: null,
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { email: { startsWith: head, mode: "insensitive" } },
        { name: { startsWith: head, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, avatarUrl: true },
    take: limit,
    orderBy: { name: "asc" },
  })
  res.json({ users })
})

// Distinct users the current user has shared a space with (either spaces
// they own or spaces they're a member of). Used as the default suggestion
// set when the invite input is empty.
meRouter.get("/contacts", async (req, res) => {
  const user = currentUser(req)
  const rows = await prisma.spaceMember.findMany({
    where: {
      userId: { not: user.id },
      space: {
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
    },
    include: { user: true },
  })
  // Also include space owners of spaces I'm a member of (they're on
  // Space.ownerId, not necessarily in SpaceMember rows).
  const ownedBy = await prisma.space.findMany({
    where: {
      ownerId: { not: user.id },
      members: { some: { userId: user.id } },
    },
    include: { owner: true },
  })

  const byId = new Map<
    string,
    { id: string; name: string; email: string; avatarUrl: string | null }
  >()
  for (const m of rows) {
    byId.set(m.userId, {
      id: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
    })
  }
  for (const s of ownedBy) {
    if (s.owner)
      byId.set(s.owner.id, {
        id: s.owner.id,
        name: s.owner.name,
        email: s.owner.email,
        avatarUrl: s.owner.avatarUrl,
      })
  }
  res.json({ contacts: Array.from(byId.values()) })
})

meRouter.get("/starred", async (req, res) => {
  const user = currentUser(req)
  const spaceIds = (
    await prisma.spaceMember.findMany({
      where: { userId: user.id },
      select: { spaceId: true },
    })
  ).map((m) => m.spaceId)
  const [folders, files] = await Promise.all([
    prisma.folder.findMany({
      where: {
        isStarred: true,
        isTrashed: false,
        isHidden: false,
        OR: [{ ownerId: user.id }, { spaceId: { in: spaceIds } }],
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.file.findMany({
      where: {
        isStarred: true,
        isTrashed: false,
        isHidden: false,
        OR: [{ ownerId: user.id }, { spaceId: { in: spaceIds } }],
      },
      orderBy: { updatedAt: "desc" },
    }),
  ])
  res.json({
    folders,
    files: files.map((f) => ({ ...f, size: Number(f.size) })),
  })
})

meRouter.get("/trash", async (req, res) => {
  const user = currentUser(req)
  // `deletedAt: null` excludes items the user has already permanently deleted —
  // those live on in the admin recycle bin and must not reappear in the user's
  // own bin.
  const [folders, files] = await Promise.all([
    prisma.folder.findMany({
      where: { ownerId: user.id, isTrashed: true, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.file.findMany({
      where: { ownerId: user.id, isTrashed: true, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    }),
  ])
  res.json({
    folders,
    files: files.map((f) => ({ ...f, size: Number(f.size) })),
  })
})

// Shared by manual "empty bin" and the scheduled auto-purge below. Permanently
// deletes from the user's point of view: the given trashed files/folders (plus
// every descendant of those folders) are soft-deleted into the admin-only
// recycle bin (stamped deletedAt) so an admin can still restore or purge them.
// Nothing is actually destroyed — storage blobs are retained.
async function purgeTrashed(
  fileIds: string[],
  rootFolderIds: string[],
  deletedById: string | null
) {
  // Walk the trashed-folder subtree so every descendant folder (and its files)
  // is stamped too — the DB has no cascade for a non-destructive update.
  const folderIds = new Set<string>(rootFolderIds)
  let frontier = rootFolderIds
  while (frontier.length > 0) {
    const children = await prisma.folder.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    })
    const next = children.map((c) => c.id).filter((id) => !folderIds.has(id))
    next.forEach((id) => folderIds.add(id))
    frontier = next
  }

  const data = { deletedAt: new Date(), deletedById, isTrashed: true }
  const allFolderIds = [...folderIds]
  const [directFiles, descendantFiles] = await prisma.$transaction([
    // Files sitting directly in the bin.
    prisma.file.updateMany({ where: { id: { in: fileIds } }, data }),
    // Files anywhere inside a trashed folder subtree.
    prisma.file.updateMany({
      where: { folderId: { in: allFolderIds }, deletedAt: null },
      data,
    }),
    prisma.folder.updateMany({
      where: { id: { in: allFolderIds }, deletedAt: null },
      data,
    }),
  ])

  return { files: directFiles.count + descendantFiles.count, folders: allFolderIds.length }
}

// Empty the user's bin — everything currently in it, regardless of age.
meRouter.post("/trash/empty", async (req, res) => {
  const user = currentUser(req)
  const [trashedFiles, trashedFolders] = await Promise.all([
    prisma.file.findMany({
      where: { ownerId: user.id, isTrashed: true, deletedAt: null },
      select: { id: true },
    }),
    prisma.folder.findMany({
      where: { ownerId: user.id, isTrashed: true, deletedAt: null },
      select: { id: true },
    }),
  ])
  const result = await purgeTrashed(
    trashedFiles.map((f) => f.id),
    trashedFolders.map((f) => f.id),
    user.id
  )
  res.json({ ok: true, ...result })
})

// Auto-purge: items sitting in a user's bin longer than the retention window
// are swept into the admin recycle bin automatically, same as if the user had
// clicked "Delete forever" — mirrors Google Drive's 30-day trash retention.
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const TRASH_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000

async function sweepExpiredTrash() {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS)
  const [staleFiles, staleFolders] = await Promise.all([
    prisma.file.findMany({
      where: { isTrashed: true, deletedAt: null, updatedAt: { lt: cutoff } },
      select: { id: true },
    }),
    prisma.folder.findMany({
      where: { isTrashed: true, deletedAt: null, updatedAt: { lt: cutoff } },
      select: { id: true },
    }),
  ])
  if (staleFiles.length === 0 && staleFolders.length === 0) return
  const result = await purgeTrashed(
    staleFiles.map((f) => f.id),
    staleFolders.map((f) => f.id),
    null
  )
  console.log(
    `[trash] auto-purged ${result.files} file(s), ${result.folders} folder(s) past ${TRASH_RETENTION_MS / 86400000}-day retention`
  )
}

setInterval(() => {
  void sweepExpiredTrash().catch((e) => console.error("[trash] auto-purge sweep failed", e))
}, TRASH_SWEEP_INTERVAL_MS).unref()

meRouter.get("/recent", async (req, res) => {
  const user = currentUser(req)
  const limit = Math.min(parseInt(String(req.query.limit ?? "24"), 10) || 24, 100)
  const rows = await prisma.fileAccess.findMany({
    where: { userId: user.id },
    orderBy: { accessedAt: "desc" },
    distinct: ["fileId"],
    take: limit,
    include: { file: true },
  })
  const files = rows
    .filter((r) => r.file && !r.file.isTrashed)
    .map((r) => ({
      ...r.file,
      size: Number(r.file.size),
      accessedAt: r.accessedAt,
      action: r.action,
    }))
  res.json({ files })
})

// Files the user can see that were added in the last 30 days and that they
// haven't viewed or downloaded yet. Opening the file (inline preview or
// download) writes a FileAccess row, which drops the file from this list.
meRouter.get("/recently-added", async (req, res) => {
  const user = currentUser(req)
  const limit = Math.min(parseInt(String(req.query.limit ?? "12"), 10) || 12, 50)
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
  const spaceIds = (
    await prisma.spaceMember.findMany({
      where: { userId: user.id },
      select: { spaceId: true },
    })
  ).map((m) => m.spaceId)

  const files = await prisma.file.findMany({
    where: {
      isTrashed: false,
      isHidden: false,
      createdAt: { gte: since },
      OR: [{ ownerId: user.id }, { spaceId: { in: spaceIds } }],
      accesses: { none: { userId: user.id } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  res.json({ files: files.map((f) => ({ ...f, size: Number(f.size) })) })
})

// One random file of the user's that has been sitting untouched: uploaded more
// than 30 days ago and not opened in that time. Backs Home's "Rediscover" card;
// null for a drive with nothing that old.
meRouter.get("/rediscover", async (req, res) => {
  const user = currentUser(req)
  const before = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
  const where = {
    ownerId: user.id,
    isTrashed: false,
    isHidden: false,
    createdAt: { lt: before },
    accesses: { none: { userId: user.id, accessedAt: { gte: before } } },
  }
  const count = await prisma.file.count({ where })
  if (count === 0) return res.json({ file: null })
  const file = await prisma.file.findFirst({
    where,
    orderBy: { id: "asc" },
    skip: Math.floor(Math.random() * count),
  })
  res.json({ file: file && { ...file, size: Number(file.size) } })
})

// Every file owned by the user, newest first — a straightforward history of
// what they've uploaded, paged by cursor since it only grows over time.
meRouter.get("/uploads", async (req, res) => {
  const user = currentUser(req)
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200)
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined
  const files = await prisma.file.findMany({
    where: { ownerId: user.id, isTrashed: false },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  })
  res.json({
    files: files.map((f) => ({ ...f, size: Number(f.size) })),
    nextCursor: files.length === limit ? files[files.length - 1].id : null,
  })
})

meRouter.get("/folder-suggestions", async (req, res) => {
  const user = currentUser(req)
  const limit = Math.min(parseInt(String(req.query.limit ?? "8"), 10) || 8, 30)
  // Starred first, then recently touched folders owned by the user or in their spaces.
  const spaceIds = (
    await prisma.spaceMember.findMany({
      where: { userId: user.id },
      select: { spaceId: true },
    })
  ).map((m) => m.spaceId)
  const folders = await prisma.folder.findMany({
    where: {
      isTrashed: false,
      isHidden: false,
      parentId: { not: null }, // exclude root folders
      OR: [{ ownerId: user.id }, { spaceId: { in: spaceIds } }],
    },
    orderBy: [{ isStarred: "desc" }, { updatedAt: "desc" }],
    take: limit,
  })
  res.json({ folders })
})

meRouter.get("/suggestions", async (req, res) => {
  const user = currentUser(req)
  const limit = Math.min(parseInt(String(req.query.limit ?? "12"), 10) || 12, 50)
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
  const grouped = await prisma.fileAccess.groupBy({
    by: ["fileId"],
    where: { userId: user.id, accessedAt: { gte: since } },
    _count: { _all: true },
    _max: { accessedAt: true },
    orderBy: [{ _count: { fileId: "desc" } }, { _max: { accessedAt: "desc" } }],
    take: limit * 2,
  })
  if (grouped.length === 0) return res.json({ files: [] })

  const now = Date.now()
  // combine frequency + recency: weight = count / days_since^0.5
  const scored = grouped
    .map((g) => {
      const ageH = Math.max(1, (now - (g._max.accessedAt?.getTime() ?? now)) / 3600000)
      return { fileId: g.fileId, score: g._count._all / Math.sqrt(ageH) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const files = await prisma.file.findMany({
    where: { id: { in: scored.map((s) => s.fileId) }, isTrashed: false },
  })
  const byId = new Map(files.map((f) => [f.id, f]))
  const ordered = scored
    .map((s) => byId.get(s.fileId))
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => ({ ...f, size: Number(f.size) }))

  res.json({ files: ordered })
})

meRouter.post("/access", async (req, res) => {
  const user = currentUser(req)
  const body = z
    .object({ fileId: z.string(), action: z.enum(["view", "download"]).default("view") })
    .parse(req.body)
  // ensure file exists; access control is handled elsewhere on the actual fetch
  const file = await prisma.file.findUnique({ where: { id: body.fileId } })
  if (!file) return res.status(404).json({ error: "not_found" })
  await prisma.fileAccess.create({
    data: { userId: user.id, fileId: body.fileId, action: body.action },
  })
  res.json({ ok: true })
})

// --- Session-backed navigation stack -----------------------------------------

function getNav(req: any) {
  if (!req.session.nav) req.session.nav = { stack: [], index: -1 }
  return req.session.nav as { stack: string[]; index: number }
}

function navState(nav: { stack: string[]; index: number }) {
  return {
    current: nav.stack[nav.index] ?? null,
    canBack: nav.index > 0,
    canForward: nav.index >= 0 && nav.index < nav.stack.length - 1,
    length: nav.stack.length,
    index: nav.index,
  }
}

meRouter.get("/nav", (req, res) => {
  res.json(navState(getNav(req)))
})

meRouter.post("/nav/push", (req, res) => {
  const body = z.object({ path: z.string().min(1).max(512) }).parse(req.body)
  const nav = getNav(req)
  if (nav.stack[nav.index] === body.path) {
    return res.json(navState(nav))
  }
  nav.stack = nav.stack.slice(0, nav.index + 1)
  nav.stack.push(body.path)
  if (nav.stack.length > 100) nav.stack.splice(0, nav.stack.length - 100)
  nav.index = nav.stack.length - 1
  req.session.save(() => res.json(navState(nav)))
})

meRouter.post("/nav/back", (req, res) => {
  const nav = getNav(req)
  if (nav.index > 0) nav.index -= 1
  req.session.save(() => res.json(navState(nav)))
})

meRouter.post("/nav/forward", (req, res) => {
  const nav = getNav(req)
  if (nav.index < nav.stack.length - 1) nav.index += 1
  req.session.save(() => res.json(navState(nav)))
})
