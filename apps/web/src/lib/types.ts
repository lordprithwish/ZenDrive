export type User = {
  id: string
  email: string
  name: string
  avatarUrl?: string | null
  rootFolderId: string
  // Root of the gallery tree ("My Photos") — a second root alongside My
  // Drive, where DarkGallery uploads land.
  photosRootFolderId: string
  // Root of "Synced Folders", a third root: one child per folder the desktop
  // app keeps in sync with a folder on a computer.
  syncRootFolderId: string
  role: "USER" | "ADMIN"
  storageQuotaBytes: number
  // Set when this browser signed in with a temporary code (see
  // components/TempSessionsCard) — when the session ends.
  tempSessionExpiresAt: string | null
}

export type QuotaInfo = {
  used: number
  total: number
  role: "USER" | "ADMIN"
  upgradeRequestedAt: string | null
  upgradeRequestedBytes: number | null
  byType: Record<Exclude<SearchTypeFilter, "all" | "folder">, number>
  bytesByType: Record<Exclude<SearchTypeFilter, "all" | "folder">, number>
}

// Backing payload for the storage analyzer — GET /api/me/storage.
export type StorageData = { files: FileItem[]; folders: Folder[]; quota: number }

export type RecentFile = FileItem & { accessedAt: string; action: "view" | "download" }

export type NotificationType =
  | "space_invite"
  | "space_role_changed"
  | "space_removed"
  | "space_access_requested"
  | "space_access_denied"
  | "folder_share"
  | "quota_upgrade_approved"
  | "quota_upgrade_denied"
  | "quota_changed"
  | "quota_near_limit"

export type AppNotification = {
  id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

export type NavState = {
  current: string | null
  canBack: boolean
  canForward: boolean
  length: number
  index: number
}

export type ServerStats = {
  host: {
    platform: string
    arch: string
    hostname: string
    release: string
    node: string
    uptimeSec: number
  }
  process: {
    pid: number
    uptimeSec: number
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
  }
  cpu: {
    model: string
    cores: number
    speedMHz: number
    usagePct: number
    load1: number
    load5: number
    load15: number
  }
  memory: { total: number; free: number; used: number; pct: number }
  disk: { total: number; free: number; used: number; pct: number } | null
  redis: {
    hits: number
    misses: number
    evictedKeys: number
    totalConnections: number
  } | null
}

export type AdminStats = {
  users: {
    total: number
    active: number
    disabled: number
    admins: number
    newLast30d: number
    growth: { month: string; count: number }[]
  }
  storage: {
    usedBytes: number
    totalQuotaBytes: number
    trashedBytes: number
    trashedCount: number
    recycleBinBytes: number
    recycleBinCount: number
    topStorage: {
      id: string
      name: string
      email: string
      avatarUrl: string | null
      usedBytes: number
      fileCount: number
      quotaBytes: number
    }[]
  }
  files: {
    total: number
    byType: Record<string, number>
    bytesByType: Record<string, number>
    largest: {
      id: string
      name: string
      mimeType: string
      size: number
      createdAt: string
      owner: { id: string; name: string; email: string } | null
    }[]
    duplicates: { name: string; size: number; count: number; sampleId: string }[]
  }
  activity: {
    accesses7d: number
    accesses30d: number
    hourlyLast7d: number[]
    peakHour: number
    recent: {
      id: string
      fileId: string | null
      action: string
      accessedAt: string
      fileName: string
      mimeType: string
      user: { name: string; email: string; avatarUrl: string | null }
    }[]
  }
  logins: {
    recent: {
      id: string
      ip: string | null
      userAgent: string | null
      createdAt: string
      user: { name: string; email: string; avatarUrl: string | null }
    }[]
  }
  sharing: {
    shortcuts: number
    filesInSpaces: number
    shareLinks: number
    spaces: number
  }
}

export type AdminUser = {
  id: string
  email: string
  name: string
  role: "USER" | "ADMIN"
  storageQuotaBytes: number
  usedBytes: number
  upgradeRequestedAt: string | null
  upgradeRequestedBytes: number | null
  disabledAt: string | null
  createdAt: string
  avatarUrl: string | null
}

// A space as seen from the admin dashboard — every space on the instance,
// not just ones the admin owns or has joined. Backed by GET /api/admin/spaces.
export type AdminSpace = {
  id: string
  name: string
  color: string | null
  logoKey: string | null
  icon: string | null
  rootFolderId: string
  ownerId: string
  ownerName: string | null
  ownerEmail: string | null
  isPublic: boolean
  memberCount: number
  createdAt: string
}

// Full lifecycle of a single user — everything the admin can see about what
// they've stored and done. Backed by GET /api/admin/users/:id/detail.
export type UserDetail = {
  user: {
    id: string
    email: string
    name: string
    avatarUrl: string | null
    role: "USER" | "ADMIN"
    createdAt: string
    disabledAt: string | null
    storageQuotaBytes: number
    upgradeRequestedAt: string | null
    upgradeRequestedBytes: number | null
  }
  storage: {
    usedBytes: number
    quotaBytes: number
    pct: number
    fileCount: number
    folderCount: number
    trashedCount: number
    trashedBytes: number
    recycleBinCount: number
    recycleBinBytes: number
    byType: Record<string, number>
    bytesByType: Record<string, number>
  }
  largestFiles: {
    id: string
    name: string
    mimeType: string
    size: number
    createdAt: string
  }[]
  recentFiles: {
    id: string
    name: string
    mimeType: string
    size: number
    createdAt: string
  }[]
  activity: {
    views7d: number
    downloads7d: number
    views30d: number
    downloads30d: number
    total: number
    lastActiveAt: string | null
    recent: {
      id: string
      action: string
      accessedAt: string
      fileId: string | null
      fileName: string
      mimeType: string
    }[]
  }
  logins: {
    total: number
    lastLoginAt: string | null
    recent: {
      id: string
      ip: string | null
      userAgent: string | null
      createdAt: string
    }[]
  }
  sharing: {
    shareLinks: number
    shortcuts: number
    spacesOwned: { id: string; name: string; memberCount: number; isPublic: boolean }[]
    memberships: { spaceId: string; name: string; role: string }[]
  }
}

// Admin recycle bin — items users have permanently deleted, retained for admins.
export type RecycleBinPerson = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

export type RecycleBinFolder = {
  id: string
  name: string
  color: string | null
  owner: RecycleBinPerson | null
  deletedBy: RecycleBinPerson | null
  deletedAt: string
  sizeBytes: number
  fileCount: number
  folderCount: number
}

export type RecycleBinFile = {
  id: string
  name: string
  mimeType: string
  size: number
  owner: RecycleBinPerson | null
  deletedBy: RecycleBinPerson | null
  deletedAt: string
}

export type RecycleBinData = {
  folders: RecycleBinFolder[]
  files: RecycleBinFile[]
  totals: { folders: number; files: number; bytes: number }
}

// A user's folder tree, for the recycle bin's "move to" destination picker.
export type AdminFolderTree = {
  rootId: string
  folders: { id: string; name: string; parentId: string | null }[]
}

export type Folder = {
  id: string
  name: string
  color: string | null
  thumbnailKey?: string | null
  ownerId: string
  parentId: string | null
  spaceId: string | null
  isHidden: boolean
  isTrashed: boolean
  isStarred: boolean
  createdAt: string
  updatedAt: string
  // Only a folder on this computer has one, once it's been measured (pages/Local).
  size?: number | null
}

export type FileItem = {
  id: string
  name: string
  ownerId: string
  folderId: string
  spaceId: string | null
  size: number
  mimeType: string
  storageKey: string
  thumbnailKey?: string | null
  thumbnailState?: string | null
  // Saved default audio stream index for video files with multiple audio
  // tracks (see AudioTrack) — null plays the source's own default track.
  audioTrackIndex?: number | null
  // Saved playback position in seconds, so reopening a video resumes where
  // the user left off. Null = start from the top.
  playbackPositionSec?: number | null
  isHidden: boolean
  isTrashed: boolean
  isStarred: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
  // Present when the file is surfaced into the current folder via a shortcut.
  // The file's canonical home is still its own folder — this is just a link.
  isShortcut?: boolean
  shortcutId?: string
}

// A sidecar subtitle track discovered next to a video file. `src` points at the
// API endpoint that serves it as WebVTT.
export type SubtitleTrack = {
  id: string
  label: string
  lang: string | null
  src: string
}

// An embedded audio stream on a video file, probed server-side (ffprobe).
// `index` is the container's stream index, passed back as `?audio=` to pick
// it — browsers don't reliably expose/switch embedded multi-audio streams
// themselves, so track selection is done via a server-remuxed variant.
export type AudioTrack = {
  index: number
  label: string
}

export type Breadcrumb = { id: string; name: string }

export type SearchTypeFilter =
  | "all"
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "doc"
  | "archive"
  | "other"

export type SearchFileResult = FileItem & { folderName: string | null }
export type SearchFolderResult = Folder & { parentName: string | null }

export type SearchResponse = {
  folders: SearchFolderResult[]
  files: SearchFileResult[]
  truncated: boolean
  scope: { id: string; name: string } | null
}

// The permission layer a space and a shared synced folder have in common
// (apps/api lib/access.ts): what a member may do about adding and changing,
// and about deleting. "ASK" holds the change until the owner agrees; "NO" to
// both is read-only.
export type Can = "YES" | "ASK" | "NO"
export type MemberCan = { canUpload: Can; canDelete: Can }
/** A change by a member who has to ask: something added, or something to delete. */
export type MemberRequest = {
  id: string
  path: string
  size: number
  kind: "upload" | "delete"
  by: string
}

export type SpaceMember = {
  userId: string
  // The coarse form of the two settings below: VIEWER when canUpload is "NO".
  role: "VIEWER" | "EDITOR"
  canUpload: Can
  canDelete: Can
  name: string
  email: string
  avatarUrl?: string | null
  // Set when this member has an open request to be promoted to EDITOR.
  editorRequestedAt?: string | null
}

export type Space = {
  id: string
  name: string
  color: string | null
  logoKey: string | null
  icon: string | null
  rootFolderId: string
  ownerId: string
  isPublic: boolean
  createdAt: string
  members: SpaceMember[]
  // Whether the current viewer has pinned this space to their sidebar.
  // Only meaningful for joined (non-owned) spaces.
  pinned: boolean
}

export type SpaceStats = {
  fileCount: number
  folderCount: number
  totalBytes: number
  memberCount: number
  lastActivityAt: string
}

// Backing payload for the Space Overview page — GET /api/spaces/:id/overview.
export type SpaceOverview = {
  space: Space
  stats: SpaceStats
  recentFiles: FileItem[]
}

export type PublicSpace = {
  id: string
  name: string
  color: string | null
  logoKey: string | null
  icon: string | null
  rootFolderId: string
  ownerId: string
  isPublic: boolean
  ownerName: string | null
  createdAt: string
}

export type Share = {
  id: string
  token: string
  resourceType: "FILE" | "FOLDER"
  permission: "VIEW" | "EDIT"
  fileId?: string | null
  folderId?: string | null
  expiresAt?: string | null
  createdAt: string
  hasPassword?: boolean
  /** A folder link that opens the folders inside it too. */
  includeSubfolders?: boolean
}

export type SpaceInvite = {
  id: string
  spaceId: string
  token: string
  role: "VIEWER" | "EDITOR"
  createdById: string
  maxUses: number | null
  useCount: number
  expiresAt: string | null
  createdAt: string
}
