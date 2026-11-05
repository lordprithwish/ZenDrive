import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowsOutCardinalIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderSimpleDashedIcon,
  InfoIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  StarIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { HoverName } from "@/components/HoverName"
import { Modal } from "@/components/Modal"
import { apiGet, apiJson } from "@/lib/api"
import { iconFor } from "@/lib/fileIcon"
import { formatBytes, relativeTime } from "@/lib/format"
import type { Breadcrumb, FileItem, Folder } from "@/lib/types"
import { useAuth } from "@/store/auth"
import { useDrive } from "@/store/drive"

type FolderNode = {
  id: string
  name: string
  parentId: string | null
  isStarred?: boolean
  color?: string | null
}
type TreeResponse = { rootId: string; folders: FolderNode[] }
type Contents = { folder: Folder; folders: Folder[]; files: FileItem[]; breadcrumbs: Breadcrumb[] }

type Props = {
  open: boolean
  items: { type: "folder" | "file"; id: string }[]
  displayName: string
  currentParentId: string | null // folderId for files, parentId for folders
  /** Pick where to link the items instead: only a synced folder can be chosen. */
  link?: boolean
  onClose: () => void
  onSubmit: (targetFolderId: string) => void | Promise<void>
}

// The last few places things went, on this browser only. A shortcut: in a
// private window or with storage cleared there are simply none to offer.
const RECENTS_KEY = "move-recents"
function readRecents(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}
function rememberRecent(id: string) {
  try {
    const next = [id, ...readRecents().filter((r) => r !== id)].slice(0, 6)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    // Storage is off: nothing to remember.
  }
}

// `text` with the part that matches the search highlighted.
function Match({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-primary/25 text-foreground rounded-sm">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

// A folder drawn the colour it has in the drive.
export function FolderGlyph({ node, open, size = 16 }: { node?: FolderNode; open?: boolean; size?: number }) {
  const Icon = open ? FolderOpenIcon : FolderIcon
  return (
    <Icon
      size={size}
      weight="fill"
      style={{ color: node?.color || undefined }}
      className={cn("shrink-0", !node?.color && "text-primary")}
    />
  )
}

export function Note({
  tone,
  icon,
  children,
}: {
  tone: "warn" | "good" | "info"
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "animate-in fade-in-0 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs leading-snug duration-300 motion-reduce:animate-none",
        tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "good" && "bg-success/10 text-success",
        tone === "info" && "bg-muted text-muted-foreground"
      )}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </div>
  )
}

export const Skeleton = ({ widths }: { widths: number[] }) => (
  <div className="space-y-2.5 p-2">
    {widths.map((w, i) => (
      <div key={i} className="bg-muted h-4 animate-pulse rounded" style={{ width: `${w}%` }} />
    ))}
  </div>
)

// Where to move (or link) something: find the folder on the left, by search,
// a recent or starred shortcut, or the tree; see on the right what is already
// there, so the choice is made looking at the destination, not just its name.
export function MoveDialog({
  open,
  items,
  displayName,
  currentParentId,
  link,
  onClose,
  onSubmit,
}: Props) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [contents, setContents] = useState<Record<string, Contents>>({})
  const [recents, setRecents] = useState<string[]>([])
  /** The new folder's name while one is being made, else null. */
  const [newName, setNewName] = useState<string | null>(null)
  const syncRootId = useAuth((s) => s.user?.syncRootFolderId)
  const refresh = useDrive((s) => s.refresh)
  const treeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setBusy(false)
    setErr(null)
    setTree(null)
    setQuery("")
    setContents({})
    setNewName(null)
    setRecents(readRecents())
    apiGet<TreeResponse>("/api/folders/tree/me")
      .then((r) => {
        setTree(r)
        // auto-expand path to current parent
        const byId = new Map(r.folders.map((f) => [f.id, f]))
        const exp = new Set<string>()
        let cur = currentParentId
        while (cur) {
          exp.add(cur)
          cur = byId.get(cur)?.parentId ?? null
        }
        exp.add(r.rootId)
        if (link && syncRootId) exp.add(syncRootId)
        setExpanded(exp)
      })
      .catch((e) => setErr(e.message))
  }, [open, currentParentId, link, syncRootId])

  // Folders that can't be the target: any selected folder itself and its
  // descendants, and "Synced Folders" itself, which holds only the synced
  // folders. What's put in one of those goes to every computer that keeps it.
  const forbidden = useMemo(() => {
    if (!tree) return new Set<string>()
    const folderIds = items.filter((i) => i.type === "folder").map((i) => i.id)
    const childrenOf = new Map<string, string[]>()
    for (const f of tree.folders) {
      if (!f.parentId) continue
      if (!childrenOf.has(f.parentId)) childrenOf.set(f.parentId, [])
      childrenOf.get(f.parentId)!.push(f.id)
    }
    const blocked = new Set<string>(folderIds)
    const stack = [...folderIds]
    while (stack.length) {
      const id = stack.pop()!
      for (const c of childrenOf.get(id) ?? []) {
        if (!blocked.has(c)) {
          blocked.add(c)
          stack.push(c)
        }
      }
    }
    if (syncRootId) blocked.add(syncRootId)
    return blocked
  }, [tree, items, syncRootId])

  const byId = useMemo(() => new Map((tree?.folders ?? []).map((f) => [f.id, f])), [tree])
  const label = (id: string) =>
    id === tree?.rootId ? "My Drive" : id === syncRootId ? "Synced Folders" : (byId.get(id)?.name ?? "")
  // Root first, the folder itself last. Depth-guarded, like the API's own walk.
  const pathOf = (id: string) => {
    const out: string[] = []
    for (let cur = byId.get(id); cur && out.length < 64; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
      out.unshift(cur.id)
    return out
  }
  // Under a root this picker draws: only Synced Folders when linking.
  const inPicker = (id: string) => {
    const top = pathOf(id)[0]
    return !!top && (link ? top === syncRootId : top === tree?.rootId || top === syncRootId)
  }
  const pickable = (id: string) => inPicker(id) && !forbidden.has(id)

  const recentIds = recents.filter((id) => byId.has(id) && pickable(id))
  const starredIds = (tree?.folders ?? [])
    .filter((f) => f.isStarred && pickable(f.id))
    .slice(0, 8)
    .map((f) => f.id)
  const q = query.trim().toLowerCase()
  const results = q
    ? (tree?.folders ?? []).filter((f) => inPicker(f.id) && label(f.id).toLowerCase().includes(q)).slice(0, 50)
    : []

  // Select a folder from anywhere (search, a shortcut) and open the tree down to it.
  function pick(id: string) {
    setSelected(id)
    setNewName(null)
    const parents = pathOf(id).slice(0, -1)
    setExpanded((prev) => new Set([...prev, ...parents]))
  }

  useEffect(() => {
    if (!selected) return
    treeRef.current
      ?.querySelector(`[data-folder="${selected}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [selected])

  // What's in the chosen folder, fetched once per folder while the dialog is open.
  useEffect(() => {
    if (!selected || contents[selected]) return
    const id = selected
    apiGet<Contents>(`/api/folders/${id}/contents`)
      .then((c) => setContents((m) => ({ ...m, [id]: c })))
      // Only the preview goes without: the folder can still be picked.
      .catch(() => {})
    // Not on `contents`: each answer landing would ask again for whatever is in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const here = selected ? contents[selected] : undefined
  const single = items.length === 1 ? items[0] : undefined
  const ext =
    single?.type === "file" ? /\.([a-z0-9]{1,8})$/i.exec(displayName)?.[1]?.toLowerCase() : undefined
  const clash =
    !!single &&
    !!here &&
    [...here.folders, ...here.files].some(
      (x) => x.id !== single.id && x.name.toLowerCase() === displayName.toLowerCase()
    )
  const alike = ext && here ? here.files.filter((f) => f.name.toLowerCase().endsWith(`.${ext}`)).length : 0
  const totalSize = here ? here.files.reduce((n, f) => n + f.size, 0) : 0
  const lastChange = here
    ? [here.folder, ...here.folders, ...here.files].reduce((a, x) => (x.updatedAt > a ? x.updatedAt : a), "")
    : ""
  // Folders by name, then files newest first: what was put here lately says most about it.
  const entries = here
    ? [
        ...[...here.folders]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => ({ id: f.id, name: f.name, icon: <FolderGlyph node={f} size={14} />, meta: "" })),
        ...[...here.files]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((f) => ({ id: f.id, name: f.name, icon: iconFor(f.mimeType, 14, f.name), meta: formatBytes(f.size) })),
      ]
    : []

  const from = currentParentId ? label(currentParentId) : ""
  const dest = selected ? pathOf(selected) : []

  async function submit() {
    if (!selected || busy) return
    setBusy(true)
    try {
      await onSubmit(selected)
      rememberRecent(selected)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "move_failed")
    } finally {
      setBusy(false)
    }
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault()
    const name = newName?.trim()
    const parent = selected
    if (!name || !parent) return
    try {
      const f = await apiJson<Folder>("/api/folders", "POST", { name, parentId: parent, color: null })
      setTree((t) => t && { ...t, folders: [...t.folders, { id: f.id, name: f.name, parentId: parent }] })
      // The parent's listing changed: fetched again when it's next shown.
      setContents((m) => {
        const next = { ...m }
        delete next[parent]
        return next
      })
      setExpanded((prev) => new Set(prev).add(parent))
      setSelected(f.id)
      setNewName(null)
      // The page behind may be showing the parent.
      void refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create_failed")
    }
  }

  const shortcuts = (title: string, icon: React.ReactNode, ids: string[]) =>
    ids.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground flex w-17 shrink-0 items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
          {icon}
          {title}
        </span>
        {ids.map((id) => (
          <button
            key={id}
            onClick={() => pick(id)}
            className={cn(
              "bg-card hover:border-primary flex max-w-40 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              selected === id && "border-primary bg-primary/10"
            )}
          >
            <FolderGlyph node={byId.get(id)} size={12} />
            <span className="truncate">{label(id)}</span>
          </button>
        ))}
      </div>
    )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="3xl"
      className="h-160"
      scrollBody={false}
      bodyClassName="flex"
      icon={
        link ? (
          <LinkSimpleIcon size={18} className="text-primary" />
        ) : (
          <ArrowsOutCardinalIcon size={18} className="text-primary" />
        )
      }
      title={link ? "Link to synced folder" : "Move"}
      description={
        <span className="flex min-w-0 items-baseline gap-1.5">
          <HoverName name={displayName} className="text-foreground min-w-0 truncate" />
          {from && <span className="shrink-0">· in {from}</span>}
        </span>
      }
      footer={
        <>
          {/* The whole destination, so a same-named folder elsewhere can't be mistaken for it. */}
          <div className="text-muted-foreground mr-auto flex min-w-0 items-center gap-1.5 text-xs">
            {selected ? (
              <>
                <span className="shrink-0">{link ? "Link into" : "Move to"}</span>
                <span
                  key={selected}
                  className="text-foreground animate-in fade-in-0 min-w-0 truncate font-medium duration-200"
                >
                  {dest.length > 3 && "… › "}
                  {dest.slice(-3).map(label).join(" › ")}
                </span>
              </>
            ) : (
              "Pick a folder"
            )}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!selected || selected === currentParentId || busy}>
            {link ? (busy ? "Linking…" : "Link") : busy ? "Moving…" : "Move"}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-1 flex-col sm:border-r">
        <div className="space-y-2.5 p-3">
          <div className="relative">
            <MagnifyingGlassIcon
              size={14}
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a folder"
              aria-label="Find a folder"
              className="h-8 rounded-lg pl-8 text-sm"
            />
          </div>
          {!q &&
            shortcuts("Recent", <ClockCounterClockwiseIcon size={11} />, recentIds)}
          {!q &&
            shortcuts("Starred", <StarIcon size={11} weight="fill" className="text-amber-400" />, starredIds)}
          {link && (
            <div className="text-muted-foreground px-1 text-xs">
              Stays where it is, and is kept on every computer that syncs the folder.
            </div>
          )}
          {err && <div className="text-destructive px-1 text-xs">{err}</div>}
        </div>
        <ScrollArea className="min-h-0 flex-1 border-t">
          <div ref={treeRef} className="p-2 text-sm">
            {!tree ? (
              <Skeleton widths={[70, 48, 60, 40, 66, 52]} />
            ) : q ? (
              results.length === 0 ? (
                <div className="text-muted-foreground p-6 text-center text-xs">
                  No folder called “{query.trim()}”.
                </div>
              ) : (
                results.map((f) => {
                  const parents = pathOf(f.id).slice(0, -1)
                  return (
                    <button
                      key={f.id}
                      data-folder={f.id}
                      disabled={!pickable(f.id)}
                      onClick={() => pick(f.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50",
                        selected === f.id
                          ? "bg-primary/12 ring-primary/50 ring-1 ring-inset"
                          : "hover:bg-accent/60"
                      )}
                    >
                      <FolderGlyph node={f} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <Match text={label(f.id)} q={q} />
                        </span>
                        {parents.length > 0 && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {parents.map(label).join(" › ")}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })
              )
            ) : (
              <FolderTree
                rootId={link ? undefined : tree.rootId}
                syncRootId={syncRootId}
                folders={tree.folders}
                selected={selected}
                expanded={expanded}
                forbidden={forbidden}
                currentParentId={currentParentId}
                onSelect={pick}
                onToggle={(id) =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
              />
            )}
          </div>
        </ScrollArea>
      </div>

      {/* The destination itself: what's in it, and anything worth knowing before going ahead. */}
      <aside className="bg-muted/20 hidden w-72 shrink-0 flex-col sm:flex">
        {!selected ? (
          <div className="animate-in fade-in-0 flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center duration-300 motion-reduce:animate-none">
            <div className="bg-muted ring-border/60 grid size-14 place-items-center rounded-2xl ring-1">
              <FolderSimpleDashedIcon size={28} className="text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">Choose a destination</div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Pick a folder to see what's already in it before you {link ? "link" : "move"} anything there.
            </p>
          </div>
        ) : (
          <div
            key={selected}
            className="animate-in fade-in-0 slide-in-from-right-2 flex min-h-0 flex-1 flex-col duration-200 motion-reduce:animate-none"
          >
            <div className="border-b p-4">
              <FolderGlyph node={byId.get(selected)} open size={34} />
              <div className="font-heading mt-2 leading-snug font-medium wrap-anywhere">{label(selected)}</div>
              {dest.length > 1 && (
                <div className="text-muted-foreground mt-0.5 text-xs wrap-anywhere">
                  in {dest.slice(0, -1).map(label).join(" › ")}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 border-b">
              {(
                [
                  ["Folders", here?.folders.length],
                  ["Files", here?.files.length],
                  ["Size", here && formatBytes(totalSize)],
                ] as [string, string | number | undefined][]
              ).map(([k, v]) => (
                <div key={k} className="px-2 py-2.5 text-center">
                  {v === undefined ? (
                    <div className="bg-muted mx-auto h-5 w-8 animate-pulse rounded" />
                  ) : (
                    <div className="animate-in fade-in-0 text-sm font-semibold tabular-nums duration-300">{v}</div>
                  )}
                  <div className="text-muted-foreground mt-0.5 text-[10px] tracking-wide uppercase">{k}</div>
                </div>
              ))}
            </div>
            {here && (selected === currentParentId || clash || alike > 0) && (
              <div className="space-y-2 border-b p-3">
                {selected === currentParentId && (
                  <Note tone="info" icon={<InfoIcon size={14} />}>
                    It's already here.
                  </Note>
                )}
                {clash && (
                  <Note tone="warn" icon={<WarningIcon size={14} weight="fill" />}>
                    Something named “{displayName}” is already here. Both will be kept.
                  </Note>
                )}
                {alike > 0 && (
                  <Note tone="good" icon={<CheckCircleIcon size={14} weight="fill" />}>
                    Already holds {alike} .{ext} file{alike === 1 ? "" : "s"}.
                  </Note>
                )}
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-2">
                <div className="text-muted-foreground flex items-center justify-between px-2 pt-1 pb-1.5 text-[10px] font-medium tracking-wide uppercase">
                  <span>Inside</span>
                  {lastChange && (
                    <span className="tracking-normal normal-case">changed {relativeTime(lastChange)}</span>
                  )}
                </div>
                {!here ? (
                  <Skeleton widths={[64, 80, 50, 72]} />
                ) : entries.length === 0 ? (
                  <div className="text-muted-foreground px-2 py-6 text-center text-xs">Nothing in here yet.</div>
                ) : (
                  <>
                    {entries.slice(0, 40).map((x) => (
                      <div key={x.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs">
                        {x.icon}
                        <HoverName name={x.name} className="min-w-0 flex-1 truncate" />
                        {x.meta && <span className="text-muted-foreground shrink-0 tabular-nums">{x.meta}</span>}
                      </div>
                    ))}
                    {entries.length > 40 && (
                      <div className="text-muted-foreground px-2 pt-1 text-xs">and {entries.length - 40} more</div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
            <div className="border-t p-2">
              {newName === null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground w-full justify-start"
                  onClick={() => setNewName("")}
                >
                  <FolderPlusIcon size={16} />
                  New folder here
                </Button>
              ) : (
                <form onSubmit={createFolder} className="animate-in fade-in-0 flex gap-1.5 duration-150">
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      // Esc drops the name, not the whole dialog.
                      if (e.key === "Escape") {
                        e.stopPropagation()
                        setNewName(null)
                      }
                    }}
                    placeholder="Folder name"
                    aria-label="New folder name"
                    className="h-8 rounded-lg text-sm"
                  />
                  <Button type="submit" size="sm" disabled={!newName.trim()}>
                    Create
                  </Button>
                </form>
              )}
            </div>
          </div>
        )}
      </aside>
    </Modal>
  )
}

function FolderTree({
  rootId,
  syncRootId,
  folders,
  selected,
  expanded,
  forbidden,
  currentParentId,
  onSelect,
  onToggle,
}: {
  rootId?: string
  syncRootId?: string
  folders: FolderNode[]
  selected: string | null
  expanded: Set<string>
  forbidden: Set<string>
  currentParentId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}) {
  const { childrenOf, byId } = useMemo(() => {
    const m = new Map<string, FolderNode[]>()
    for (const f of folders) {
      const key = f.parentId ?? "__root__"
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(f)
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return { childrenOf: m, byId: new Map(folders.map((f) => [f.id, f])) }
  }, [folders])

  function render(id: string, name: string, depth: number): React.ReactNode {
    const node = byId.get(id)
    const kids = childrenOf.get(id) ?? []
    const hasKids = kids.length > 0
    const isOpen = expanded.has(id)
    const isForbidden = forbidden.has(id)
    const isCurrent = id === currentParentId
    const isSelected = selected === id

    return (
      <div key={id}>
        <div
          data-folder={id}
          className={`flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors duration-100 ${
            isSelected
              ? "bg-primary/12 ring-primary/50 ring-1 ring-inset"
              : isForbidden
                ? "text-muted-foreground/60"
                : "hover:bg-accent/60"
          }`}
          style={{ paddingLeft: depth * 14 + 6 }}
        >
          {hasKids ? (
            <button
              className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 shrink-0 rounded p-0.5"
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${name}`}
              aria-expanded={isOpen}
              onClick={() => onToggle(id)}
            >
              {isOpen ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          {/* A button, not a clickable row, so a folder can be picked from the keyboard. */}
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-not-allowed"
            disabled={isForbidden}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(id)}
            onDoubleClick={() => hasKids && onToggle(id)}
          >
            <FolderGlyph node={node} open={isOpen && hasKids} />
            <HoverName name={name} className="min-w-0 truncate" />
            {node?.isStarred && <StarIcon size={11} weight="fill" className="shrink-0 text-amber-400" />}
            {isCurrent && (
              <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium tracking-wide uppercase">
                current
              </span>
            )}
          </button>
        </div>
        {isOpen && hasKids && (
          <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
            {kids.map((k) => render(k.id, k.name, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {rootId && render(rootId, "My Drive", 0)}
      {/* Only once there is a synced folder to put things in. */}
      {syncRootId && childrenOf.has(syncRootId)
        ? render(syncRootId, "Synced Folders", 0)
        : !rootId && (
            <div className="text-muted-foreground p-4">
              No synced folders yet. Start one from the DarkDrive desktop app.
            </div>
          )}
    </div>
  )
}
