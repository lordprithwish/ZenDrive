import { Router } from "express"
import { z } from "zod"
import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import multer from "multer"
import { prisma } from "../db/prisma.js"
import { currentUser, requireAuth } from "../middleware/auth.js"
import { getFolderWithAccess, assertUserRootFolderId, memberOf, visibleTo } from "../lib/access.js"
import { renderImage } from "../lib/thumbnails.js"
import { storage, newStorageKey, newScratchPath, SCRATCH_ROOT } from "../storage/index.js"
import { logActivity } from "../lib/activity.js"

// Sniff the real format from magic bytes rather than trusting the `.jpg`
// storage key — covers thumbnails written before upload-time re-encoding
// existed, where raw non-JPEG bytes were stored under a `.jpg` name.
function sniffImageContentType(head: Buffer): string {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png"
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp"
  if (head.toString("ascii", 0, 6) === "GIF87a" || head.toString("ascii", 0, 6) === "GIF89a") return "image/gif"
  return "image/jpeg"
}

const thumbUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const tmp = path.join(SCRATCH_ROOT, ".tmp")
      fs.mkdirSync(tmp, { recursive: true })
      cb(null, tmp)
    },
    filename: (_req, _file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/"))
  },
})

export const foldersRouter = Router()
foldersRouter.use(requireAuth)

// List contents of a folder (subfolders + files)
foldersRouter.get("/:id/contents", async (req, res) => {
  const user = currentUser(req)
  const id = req.params.id === "root" ? await assertUserRootFolderId(user) : req.params.id
  const folder = await getFolderWithAccess(user.id, id, "read", { role: user.role })
  if (!folder) return res.status(404).json({ error: "not_found" })

  const includeHidden = req.query.includeHidden === "1"
  const includeTrashed = req.query.includeTrashed === "1"

  const [folders, realFiles, shortcuts, path] = await Promise.all([
    prisma.folder.findMany({
      where: {
        // "Synced Folders" also lists the ones other people share with the
        // user (FolderMember), which live under their owners' roots.
        OR: [
          { parentId: folder.id },
          ...(folder.id === user.syncRootFolderId ? [{ members: { some: { userId: user.id } } }] : []),
        ],
        ...(includeTrashed ? {} : { isTrashed: false }),
        ...(includeHidden ? {} : { isHidden: false }),
      },
      orderBy: { name: "asc" },
    }),
    prisma.file.findMany({
      where: {
        folderId: folder.id,
        ...(folder.ownerId === user.id ? {} : visibleTo(user.id)),
        ...(includeTrashed ? {} : { isTrashed: false }),
        ...(includeHidden ? {} : { isHidden: false }),
      },
      orderBy: { name: "asc" },
    }),
    prisma.fileShortcut.findMany({
      where: {
        folderId: folder.id,
        ...(folder.ownerId === user.id ? {} : visibleTo(user.id)),
        file: {
          ...(includeTrashed ? {} : { isTrashed: false }),
          ...(includeHidden ? {} : { isHidden: false }),
        },
      },
      include: { file: true },
    }),
    breadcrumbs(folder.id),
  ])

  const files = [
    ...realFiles.map((f) => ({ ...f, size: Number(f.size) })),
    ...shortcuts.map((s) => ({
      ...s.file,
      size: Number(s.file.size),
      shortcutId: s.id,
      isShortcut: true as const,
    })),
  ]

  res.json({ folder, folders, files, breadcrumbs: path })
})

// Serve a folder's custom thumbnail image.
foldersRouter.get("/:id/thumbnail", async (req, res) => {
  const user = currentUser(req)
  const folder = await getFolderWithAccess(user.id, req.params.id, "read", { role: user.role })
  if (!folder) return res.status(404).json({ error: "not_found" })
  if (!folder.thumbnailKey) return res.status(404).json({ error: "no_thumbnail" })
  const local = await storage.localPath(folder.thumbnailKey)
  if (!local) return res.status(404).json({ error: "gone" })
  try {
    const head = Buffer.alloc(12)
    const fd = fs.openSync(local.path, "r")
    fs.readSync(fd, head, 0, 12, 0)
    fs.closeSync(fd)
    res.setHeader("Content-Type", sniffImageContentType(head))
    res.setHeader("Cache-Control", "private, max-age=86400")
    fs.createReadStream(local.path).pipe(res).on("close", () => local.cleanup())
  } catch {
    local.cleanup()
    res.status(404).json({ error: "gone" })
  }
})

// Upload or replace a folder's custom thumbnail image.
foldersRouter.post("/:id/thumbnail", thumbUpload.single("thumbnail"), async (req, res) => {
  const user = currentUser(req)
  const folder = await getFolderWithAccess(user.id, req.params.id, "write")
  if (!folder) return res.status(403).json({ error: "forbidden" })
  const file = req.file
  if (!file) return res.status(400).json({ error: "no_file" })

  // Storage/serving always assume JPEG (`.jpg` key, `image/jpeg` content-type),
  // so re-encode whatever image/* format was uploaded rather than storing raw bytes.
  const key = newStorageKey(`folder-thumb-${folder.id}.jpg`)
  const dest = newScratchPath()
  const ok = await renderImage(file.path, dest)
  try { fs.unlinkSync(file.path) } catch {}
  if (!ok) return res.status(400).json({ error: "unsupported_image" })
  await storage.putFile(key, dest)

  const oldKey = folder.thumbnailKey
  const updated = await prisma.folder.update({
    where: { id: folder.id },
    data: { thumbnailKey: key },
  })
  if (oldKey) { try { await storage.remove(oldKey) } catch {} }
  await logActivity({ userId: user.id, folderId: folder.id, action: "thumbnail" })

  res.json(updated)
})

// Remove a folder's custom thumbnail.
foldersRouter.delete("/:id/thumbnail", async (req, res) => {
  const user = currentUser(req)
  const folder = await getFolderWithAccess(user.id, req.params.id, "write")
  if (!folder) return res.status(403).json({ error: "forbidden" })
  if (!folder.thumbnailKey) return res.json({ ok: true })
  const oldKey = folder.thumbnailKey
  await prisma.folder.update({ where: { id: folder.id }, data: { thumbnailKey: null } })
  try { await storage.remove(oldKey) } catch {}
  await logActivity({ userId: user.id, folderId: folder.id, action: "thumbnail" })
  res.json({ ok: true })
})

async function breadcrumbs(folderId: string) {
  const crumbs: { id: string; name: string }[] = []
  let cur: { id: string; name: string; parentId: string | null } | null =
    await prisma.folder.findUnique({
      where: { id: folderId },
      select: { id: true, name: true, parentId: true },
    })
  while (cur) {
    crumbs.unshift({ id: cur.id, name: cur.name })
    if (!cur.parentId) break
    cur = await prisma.folder.findUnique({
      where: { id: cur.parentId },
      select: { id: true, name: true, parentId: true },
    })
  }
  return crumbs
}

// Create folder
foldersRouter.post("/", async (req, res) => {
  const user = currentUser(req)
  const body = z
    .object({
      name: z.string().min(1).max(255),
      parentId: z.string(),
      color: z.string().max(32).nullable().optional(),
    })
    .parse(req.body)
  const parent = await getFolderWithAccess(user.id, body.parentId, "write")
  if (!parent) return res.status(403).json({ error: "forbidden" })
  const f = await prisma.folder.create({
    data: {
      name: body.name,
      color: body.color ?? null,
      parentId: parent.id,
      ownerId: parent.ownerId,
      spaceId: parent.spaceId,
    },
  })
  await logActivity({ userId: user.id, folderId: f.id, action: "create" })
  res.status(201).json(f)
})

// Rename / update flags
foldersRouter.patch("/:id", async (req, res) => {
  const user = currentUser(req)
  const body = z
    .object({
      name: z.string().min(1).max(255).optional(),
      color: z.string().max(32).nullable().optional(),
      isHidden: z.boolean().optional(),
      isStarred: z.boolean().optional(),
      isTrashed: z.boolean().optional(),
      parentId: z.string().optional(),
    })
    .parse(req.body)
  // Binning is a permission of its own in a shared synced folder
  // (FolderMember), so a request for that and nothing else needs only that.
  const binning = body.isTrashed === true
  const folder = await getFolderWithAccess(
    user.id,
    req.params.id,
    binning && Object.keys(body).length === 1 ? "trash" : "write"
  )
  if (!folder) return res.status(403).json({ error: "forbidden" })
  const member = folder.ownerId !== user.id ? await memberOf(user.id, folder.id) : null
  if (member) {
    // A member works inside the space or shared folder. Its top folder is the
    // owner's to rename, move or bin: any of those would do it to everyone.
    if (member.root === folder.id) return res.status(403).json({ error: "forbidden" })
    // Binned, or moved out of it, a folder is gone for everyone there. Unlike
    // a file there is no asking for one: a member who has to ask can't.
    const leaves =
      body.parentId !== undefined && (await memberOf(user.id, body.parentId))?.root !== member.root
    if ((binning || leaves) && member.delete !== "YES") return res.status(403).json({ error: "forbidden" })
  }

  let targetFolderName: string | undefined
  if (body.parentId) {
    const target = await getFolderWithAccess(user.id, body.parentId, "write")
    if (!target) return res.status(403).json({ error: "forbidden_target" })
    if (await isDescendant(folder.id, target.id))
      return res.status(400).json({ error: "cycle" })
    targetFolderName = target.name
    // Cascade spaceId to the moved subtree so membership follows the hierarchy.
    if ((target.spaceId ?? null) !== (folder.spaceId ?? null)) {
      await cascadeSpaceId(folder.id, target.spaceId ?? null)
    }
  }

  const updated = await prisma.folder.update({ where: { id: folder.id }, data: body })

  const logs: Promise<unknown>[] = []
  if (body.name !== undefined && body.name !== folder.name)
    logs.push(
      logActivity({
        userId: user.id,
        folderId: folder.id,
        action: "rename",
        detail: { from: folder.name, to: body.name },
      })
    )
  if (body.parentId !== undefined && body.parentId !== folder.parentId)
    logs.push(
      logActivity({
        userId: user.id,
        folderId: folder.id,
        action: "move",
        detail: { to: targetFolderName },
      })
    )
  if (body.color !== undefined && body.color !== folder.color)
    logs.push(logActivity({ userId: user.id, folderId: folder.id, action: "color" }))
  if (body.isStarred !== undefined && body.isStarred !== folder.isStarred)
    logs.push(
      logActivity({
        userId: user.id,
        folderId: folder.id,
        action: body.isStarred ? "star" : "unstar",
      })
    )
  if (body.isTrashed !== undefined && body.isTrashed !== folder.isTrashed)
    logs.push(
      logActivity({
        userId: user.id,
        folderId: folder.id,
        action: body.isTrashed ? "trash" : "restore",
      })
    )
  await Promise.all(logs)

  res.json(updated)
})

// Mirror a folder tree into a target folder, creating shortcuts for every
// file found along the way. Used by "Add to space" and the space's "Link
// files" for folders: the source tree stays in the uploader's drive; a
// parallel folder structure with file-shortcuts, the folder itself at the
// top, appears in the target (typically a shared space).
foldersRouter.post("/:id/mirror", async (req, res) => {
  const user = currentUser(req)
  const { targetFolderId } = z
    .object({ targetFolderId: z.string() })
    .parse(req.body)
  const source = await getFolderWithAccess(user.id, req.params.id, "read")
  if (!source) return res.status(404).json({ error: "not_found" })
  const target = await getFolderWithAccess(user.id, targetFolderId, "write")
  if (!target) return res.status(403).json({ error: "forbidden_target" })
  // Block the obvious cycle: can't mirror a folder into itself or a descendant.
  if (source.id === target.id || (await isDescendant(source.id, target.id)))
    return res.status(400).json({ error: "cycle" })
  // Already sitting right there: its mirror would be found as itself below.
  if (source.parentId === target.id) return res.status(400).json({ error: "already_there" })

  const targetSpaceId = target.spaceId

  // Found by name before it is made, so linking the same folder again tops up
  // the one that's there with what's new instead of leaving a second copy of
  // the whole tree next to it (the walk isn't one transaction: a retry after
  // a half-done run has to be safe).
  async function mirrorOf(src: { name: string; color: string | null }, destId: string) {
    const there = await prisma.folder.findFirst({
      where: { parentId: destId, name: src.name, isTrashed: false },
      select: { id: true },
    })
    if (there) return there.id
    const made = await prisma.folder.create({
      data: {
        name: src.name,
        color: src.color,
        parentId: destId,
        ownerId: user.id,
        spaceId: targetSpaceId,
      },
    })
    return made.id
  }

  async function walk(sourceId: string, destId: string) {
    const [files, subFolders] = await Promise.all([
      prisma.file.findMany({
        where: { folderId: sourceId, isTrashed: false, isHidden: false },
        select: { id: true },
      }),
      prisma.folder.findMany({
        where: { parentId: sourceId, isTrashed: false, isHidden: false },
      }),
    ])
    // One insert per folder, not one per file: a whole folder can be thousands.
    await prisma.fileShortcut.createMany({
      data: files.map((f) => ({ fileId: f.id, folderId: destId })),
      skipDuplicates: true,
    })
    for (const sub of subFolders) await walk(sub.id, await mirrorOf(sub, destId))
  }
  // The folder itself goes in, not only what's in it.
  await walk(source.id, await mirrorOf(source, target.id))
  res.status(201).json({ ok: true })
})

async function cascadeSpaceId(rootFolderId: string, spaceId: string | null) {
  const ids = new Set<string>([rootFolderId])
  let frontier = [rootFolderId]
  while (frontier.length) {
    const kids = await prisma.folder.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    })
    frontier = []
    for (const k of kids) {
      if (!ids.has(k.id)) {
        ids.add(k.id)
        frontier.push(k.id)
      }
    }
  }
  const all = Array.from(ids)
  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: all } }, data: { spaceId } }),
    prisma.file.updateMany({ where: { folderId: { in: all } }, data: { spaceId } }),
  ])
}

async function isDescendant(rootId: string, candidateId: string): Promise<boolean> {
  // true if candidateId is a descendant of rootId
  let cur: string | null = candidateId
  while (cur) {
    if (cur === rootId) return true
    const p: { parentId: string | null } | null = await prisma.folder.findUnique({
      where: { id: cur },
      select: { parentId: true },
    })
    cur = p?.parentId ?? null
  }
  return false
}

// "Permanent" delete from the user's point of view. Like files, a folder is not
// destroyed — the whole subtree (this folder, its descendant folders, and every
// file within) is soft-deleted into the admin-only recycle bin so an admin can
// still restore or purge it. Nothing on disk is removed until an admin purges.
// The entire subtree is stamped isTrashed=true + deletedAt so no descendant can
// leak into an isTrashed:false listing.
foldersRouter.delete("/:id", async (req, res) => {
  const user = currentUser(req)
  const folder = await getFolderWithAccess(user.id, req.params.id, "admin")
  if (!folder) return res.status(403).json({ error: "forbidden" })
  if (!folder.parentId) return res.status(400).json({ error: "cannot_delete_root" })
  const folderIds = await collectFolderSubtree(folder.id)
  const now = new Date()
  const data = { deletedAt: now, deletedById: user.id, isTrashed: true }
  await prisma.$transaction([
    prisma.file.updateMany({
      where: { folderId: { in: folderIds }, deletedAt: null },
      data,
    }),
    prisma.folder.updateMany({
      where: { id: { in: folderIds }, deletedAt: null },
      data,
    }),
  ])
  await logActivity({ userId: user.id, folderId: folder.id, action: "delete" })
  res.json({ ok: true })
})

// Audit trail for the folder itself (not its contents): create, rename,
// move, color, star, trash/restore, thumbnail, share/unshare.
foldersRouter.get("/:id/activity", async (req, res) => {
  const user = currentUser(req)
  const folder = await getFolderWithAccess(user.id, req.params.id, "read", { role: user.role })
  if (!folder) return res.status(404).json({ error: "not_found" })

  const logs = await prisma.activityLog.findMany({
    where: { folderId: folder.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      action: true,
      createdAt: true,
      detail: true,
      user: { select: { name: true, avatarUrl: true } },
    },
  })

  const recent = logs.map((l) => ({
    action: l.action,
    at: l.createdAt.toISOString(),
    user: l.user ? { name: l.user.name, avatarUrl: l.user.avatarUrl ?? null } : null,
    detail: l.detail as Record<string, unknown> | null,
  }))

  res.json({ stats: { lastActivity: recent[0]?.at ?? null }, recent })
})

// Collect every folder id in the subtree rooted at `rootId` (inclusive),
// following parent→child links. Used to apply subtree-wide operations
// (soft-delete / restore) that the DB's FK cascade can't express for a
// non-destructive update.
async function collectFolderSubtree(rootId: string): Promise<string[]> {
  const ids = [rootId]
  const seen = new Set(ids)
  let frontier = [rootId]
  while (frontier.length) {
    const children = await prisma.folder.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    })
    frontier = []
    for (const c of children) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        ids.push(c.id)
        frontier.push(c.id)
      }
    }
  }
  return ids
}

// Tree (user's own drive + spaces they're in) for sidebar
foldersRouter.get("/tree/me", async (req, res) => {
  const user = currentUser(req)
  const rootId = await assertUserRootFolderId(user)
  const mine = await prisma.folder.findMany({
    where: { ownerId: user.id, spaceId: null, isTrashed: false },
    // Starred and colour: the move picker offers starred folders as shortcuts
    // and draws each folder the colour it has in the drive.
    select: { id: true, name: true, parentId: true, isStarred: true, color: true },
  })

  // Only the drive tree, and "Synced Folders" beside it: a root of its own,
  // which the pickers that draw the tree from rootId never reach, and the move
  // picker draws as a second one. A folder whose parent chain reaches neither
  // is somewhere the move/link/search pickers have no business offering —
  // today that means the gallery's "My Photos" root and its albums, which are
  // another root of their own (see routes/gallery.ts). Depth-guarded like
  // sync.ts's walk: nothing should create a parent cycle, but an unbounded
  // loop over user-shaped data isn't worth the risk.
  const byId = new Map(mine.map((f) => [f.id, f]))
  const inDrive = (id: string): boolean => {
    let cur: string | null = id
    for (let i = 0; cur && i < 64; i++) {
      if (cur === rootId || cur === user.syncRootFolderId) return true
      cur = byId.get(cur)?.parentId ?? null
    }
    return false
  }
  res.json({ rootId, folders: mine.filter((f) => inDrive(f.id)) })
})
