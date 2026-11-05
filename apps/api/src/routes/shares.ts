import { Router } from "express"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { nanoid } from "nanoid"
import { prisma } from "../db/prisma.js"
import { currentUser, denyTempSession, requireAuth } from "../middleware/auth.js"
import { getFileWithAccess, getFolderWithAccess } from "../lib/access.js"
import { streamStoredFile } from "../lib/stream.js"
import { env } from "../env.js"
import { logActivity } from "../lib/activity.js"

export const sharesRouter = Router()

// Create a share link (authenticated)
sharesRouter.post("/", requireAuth, denyTempSession, async (req, res) => {
  const user = currentUser(req)
  const body = z
    .object({
      resourceType: z.enum(["FILE", "FOLDER"]),
      resourceId: z.string(),
      permission: z.enum(["VIEW", "EDIT"]).default("VIEW"),
      expiresAt: z.string().datetime().optional(),
      password: z.string().min(4).optional(),
      includeSubfolders: z.boolean().optional(),
    })
    .parse(req.body)

  if (body.resourceType === "FILE") {
    const f = await getFileWithAccess(user.id, body.resourceId, "admin")
    if (!f) return res.status(403).json({ error: "forbidden" })
  } else {
    const f = await getFolderWithAccess(user.id, body.resourceId, "admin")
    if (!f) return res.status(403).json({ error: "forbidden" })
  }
  const share = await prisma.share.create({
    data: {
      token: nanoid(20),
      resourceType: body.resourceType,
      permission: body.permission,
      fileId: body.resourceType === "FILE" ? body.resourceId : null,
      folderId: body.resourceType === "FOLDER" ? body.resourceId : null,
      createdById: user.id,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      passwordHash: body.password ? await bcrypt.hash(body.password, 10) : null,
      includeSubfolders: body.resourceType === "FOLDER" && !!body.includeSubfolders,
    },
  })
  await logActivity({
    userId: user.id,
    action: "share",
    fileId: share.fileId ?? undefined,
    folderId: share.folderId ?? undefined,
    detail: { permission: share.permission },
  })
  res.status(201).json({ token: share.token, id: share.id })
})

// List shares for a resource
sharesRouter.get("/for/:type/:id", requireAuth, async (req, res) => {
  const user = currentUser(req)
  const type = req.params.type.toUpperCase() as "FILE" | "FOLDER"
  const list = await prisma.share.findMany({
    where: {
      createdById: user.id,
      resourceType: type,
      ...(type === "FILE" ? { fileId: req.params.id } : { folderId: req.params.id }),
    },
  })
  // Whether a link has a password, never the hash itself.
  res.json({ shares: list.map(({ passwordHash, ...s }) => ({ ...s, hasPassword: !!passwordHash })) })
})

sharesRouter.delete("/:id", requireAuth, async (req, res) => {
  const user = currentUser(req)
  const s = await prisma.share.findUnique({ where: { id: req.params.id } })
  if (!s || s.createdById !== user.id) return res.status(403).json({ error: "forbidden" })
  await prisma.share.delete({ where: { id: s.id } })
  await logActivity({
    userId: user.id,
    action: "unshare",
    fileId: s.fileId ?? undefined,
    folderId: s.folderId ?? undefined,
  })
  res.json({ ok: true })
})

// Public: resolve a share token
sharesRouter.post("/resolve/:token", async (req, res) => {
  const s = await prisma.share.findUnique({
    where: { token: req.params.token },
    include: { file: true, folder: true },
  })
  if (!s) return res.status(404).json({ error: "not_found" })
  if (s.expiresAt && s.expiresAt < new Date()) return res.status(410).json({ error: "expired" })

  if (s.passwordHash) {
    const password = z.string().optional().parse(req.body?.password)
    if (!password || !(await bcrypt.compare(password, s.passwordHash))) {
      return res.status(401).json({ error: "password_required" })
    }
  }

  if (s.resourceType === "FILE" && s.file) {
    res.json({
      type: "FILE",
      permission: s.permission,
      file: { ...s.file, size: Number(s.file.size) },
    })
  } else if (s.resourceType === "FOLDER" && s.folder) {
    // `folderId` opens one of the folders under the shared one, which only a
    // link that includes its subfolders allows.
    const folderId = z.string().optional().parse(req.body?.folderId)
    let here = s.folder
    let path = [{ id: s.folder.id, name: s.folder.name }]
    if (folderId && folderId !== s.folder.id) {
      const found = s.includeSubfolders ? await visiblePath(folderId, s.folder.id) : null
      const folder = found && (await prisma.folder.findUnique({ where: { id: folderId } }))
      if (!found || !folder) return res.status(404).json({ error: "not_found" })
      here = folder
      path = found
    }
    const [folders, files] = await Promise.all([
      s.includeSubfolders
        ? prisma.folder.findMany({
            where: { parentId: here.id, ...VISIBLE },
            orderBy: { name: "asc" },
            include: { _count: { select: { files: { where: VISIBLE }, children: { where: VISIBLE } } } },
          })
        : [],
      prisma.file.findMany({
        where: { folderId: here.id, ...VISIBLE },
        orderBy: { name: "asc" },
      }),
    ])
    res.json({
      type: "FOLDER",
      permission: s.permission,
      includeSubfolders: s.includeSubfolders,
      folder: here,
      breadcrumbs: path,
      folders: folders.map(({ _count, ...f }) => ({ ...f, fileCount: _count.files, folderCount: _count.children })),
      files: files.map((f) => ({ ...f, size: Number(f.size) })),
    })
  } else {
    res.status(404).json({ error: "not_found" })
  }
})

// Public: download via share
sharesRouter.get("/:token/download/:fileId?", async (req, res) => {
  const s = await prisma.share.findUnique({
    where: { token: req.params.token },
    include: { file: true, folder: true },
  })
  if (!s) return res.status(404).json({ error: "not_found" })
  if (s.expiresAt && s.expiresAt < new Date()) return res.status(410).json({ error: "expired" })

  let fileId: string | undefined
  if (s.resourceType === "FILE" && s.file) fileId = s.file.id
  else if (s.resourceType === "FOLDER") fileId = req.params.fileId

  if (!fileId) return res.status(400).json({ error: "file_required" })

  // Password gate — same check /resolve does. Skipped only in local dev so a
  // developer can hit the raw download URL without wiring up the prompt every
  // time; production always enforces it.
  if (s.passwordHash && env.NODE_ENV !== "development") {
    const password = Array.isArray(req.query.password)
      ? req.query.password[0]
      : req.query.password
    if (typeof password !== "string" || !(await bcrypt.compare(password, s.passwordHash))) {
      return res.status(401).json({ error: "password_required" })
    }
  }

  const file = await prisma.file.findUnique({ where: { id: fileId } })
  if (!file) return res.status(404).json({ error: "not_found" })

  // A folder link reaches what its page lists: the files right in the folder,
  // and with its subfolders those below it too, never through a hidden or
  // binned folder, and never a hidden or binned file.
  if (s.resourceType === "FOLDER" && s.folderId) {
    const reachable =
      !file.isHidden &&
      !file.isTrashed &&
      (file.folderId === s.folderId || (s.includeSubfolders && !!(await visiblePath(file.folderId, s.folderId))))
    if (!reachable) return res.status(403).json({ error: "forbidden" })
  }

  await streamStoredFile(req, res, file, {
    disposition: req.query.inline === "1" ? "inline" : "attachment",
  })
})

const VISIBLE = { isHidden: false, isTrashed: false }

// The way down from a shared folder to one under it, shared folder first, or
// null when it isn't under it or the way passes a hidden or binned folder (what
// the share page never lists). Depth-guarded like the other parent walks.
async function visiblePath(folderId: string, rootId: string) {
  const chain: { id: string; name: string }[] = []
  let cur: string | null = folderId
  for (let i = 0; cur && i < 64; i++) {
    const f: { id: string; name: string; parentId: string | null; isHidden: boolean; isTrashed: boolean } | null =
      await prisma.folder.findUnique({
        where: { id: cur },
        select: { id: true, name: true, parentId: true, isHidden: true, isTrashed: true },
      })
    if (!f) return null
    if (f.id === rootId) return [{ id: f.id, name: f.name }, ...chain]
    if (f.isHidden || f.isTrashed) return null
    chain.unshift({ id: f.id, name: f.name })
    cur = f.parentId
  }
  return null
}
