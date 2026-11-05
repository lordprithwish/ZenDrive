import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  CheckCircleIcon,
  CheckIcon,
  GlobeIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PushPinIcon,
  UsersThreeIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { HoverName } from "@/components/HoverName"
import { Modal } from "@/components/Modal"
import { FolderGlyph, Note, Skeleton } from "@/components/MoveDialog"
import { SpaceLogo } from "@/components/SpaceLogo"
import { apiGet } from "@/lib/api"
import type { Breadcrumb, FileItem, Folder, Space, SpaceMember } from "@/lib/types"
import { useAuth } from "@/store/auth"
import { useDrive } from "@/store/drive"
import { toast } from "@/store/toast"

type Props = {
  open: boolean
  items: { type: "folder" | "file"; id: string }[]
  displayName: string
  onClose: () => void
}

type Contents = { folder: Folder; folders: Folder[]; files: FileItem[]; breadcrumbs: Breadcrumb[] }

// What the viewer may do in a space, as the API decides it for "add"
// (apps/api lib/access.ts memberMay): the owner adds; a member as their upload
// setting says, "ASK" holding the link for the owner, "NO" not at all.
type Access = "owner" | "yes" | "ask" | "no"
const ACCESS: Record<Access, { label: string; line: string }> = {
  owner: { label: "Yours", line: "Your space. What you add shows up right away." },
  yes: { label: "Can add", line: "You can add here. It shows up right away." },
  ask: { label: "Owner approves", line: "The owner approves what you add before it shows." },
  no: { label: "View only", line: "You can look around here, not add." },
}
function accessIn(s: Space, me?: string): Access {
  if (s.ownerId === me) return "owner"
  const can = s.members.find((m) => m.userId === me)?.canUpload ?? "NO"
  return can === "YES" ? "yes" : can === "ASK" ? "ask" : "no"
}

const ERRORS: Record<string, string> = {
  forbidden_target: "You can't add to that space.",
  not_found: "That's gone from your drive.",
}

function Face({ m, className }: { m: SpaceMember; className: string }) {
  return (
    <Avatar className={className}>
      {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
      <AvatarFallback className="text-[9px] font-semibold uppercase">{m.name.charAt(0)}</AvatarFallback>
    </Avatar>
  )
}

// Put a link to something of yours into a space: pick the space on the left,
// see on the right who's in it, what you may do there and which of its folders
// it goes in. Double-click a space to add straight to its top.
export function AddToSpaceDialog({ open, items, displayName, onClose }: Props) {
  const spaces = useDrive((s) => s.spaces)
  const loadSpaces = useDrive((s) => s.loadSpaces)
  const addFileToSpace = useDrive((s) => s.addFileToSpace)
  const addFolderToSpace = useDrive((s) => s.addFolderToSpace)
  const addItemsToSpace = useDrive((s) => s.addItemsToSpace)
  const me = useAuth((s) => s.user?.id)
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  /** The folder in the selected space the link goes in: its top by default. */
  const [target, setTarget] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [contents, setContents] = useState<Record<string, Contents>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setTarget(null)
    setQuery("")
    setContents({})
    setBusy(false)
    setErr(null)
    void loadSpaces()
  }, [open, loadSpaces])

  // Pinned spaces first, then by name; the ones you can't add to last.
  const ordered = useMemo(() => {
    const rank = (s: Space) => (accessIn(s, me) === "no" ? 2 : s.pinned ? 0 : 1)
    return [...spaces].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [spaces, me])
  const q = query.trim().toLowerCase()
  const shown = q ? ordered.filter((s) => s.name.toLowerCase().includes(q)) : ordered

  const space = spaces.find((s) => s.id === selected)
  const access = space && accessIn(space, me)

  // What's in the folder the link would go in, fetched once per folder while open.
  useEffect(() => {
    if (!target || contents[target]) return
    const id = target
    apiGet<Contents>(`/api/folders/${id}/contents`)
      .then((c) => setContents((m) => ({ ...m, [id]: c })))
      // Only the preview goes without: the space can still be picked.
      .catch(() => {})
    // Not on `contents`: each answer landing would ask again for whatever is in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const top = space ? contents[space.rootFolderId] : undefined
  const there = target ? contents[target] : undefined
  const single = items.length === 1 ? items[0] : undefined
  // A linked file is listed in the space under its own id, and linking it to
  // the same folder again changes nothing.
  const linked = single?.type === "file" && !!there?.files.some((f) => f.id === single.id)
  const sameName =
    single?.type === "folder" && !!there?.folders.some((f) => f.name.toLowerCase() === displayName.toLowerCase())
  const targetName =
    space && target !== space.rootFolderId ? top?.folders.find((f) => f.id === target)?.name : undefined

  function pick(s: Space) {
    setSelected(s.id)
    setTarget(s.rootFolderId)
  }

  async function add(s: Space, into: string) {
    if (busy) return
    const how = accessIn(s, me)
    setBusy(true)
    setErr(null)
    try {
      if (single) {
        if (single.type === "file") await addFileToSpace(single.id, into)
        else await addFolderToSpace(single.id, into)
      } else {
        await addItemsToSpace(items, into, s.name)
      }
      onClose()
      if (how === "ask") toast.info(`Sent to ${s.name}. It shows there once the owner agrees.`, 5000)
      // Several items get the store's own "Added N items" toast.
      else if (single)
        toast.action(`Added to ${s.name}.`, { label: "Open", onClick: () => navigate(`/drive/${into}`) }, { kind: "success" })
    } catch (e) {
      const code = e instanceof Error ? e.message : ""
      setErr(ERRORS[code] ?? "Couldn't add it. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="3xl"
      className="h-160"
      scrollBody={false}
      bodyClassName="flex"
      icon={<UsersThreeIcon size={18} className="text-primary" />}
      title="Add to space"
      description={<HoverName name={displayName} className="text-foreground block truncate" />}
      footer={
        <>
          <div className="text-muted-foreground mr-auto flex min-w-0 items-center gap-1.5 text-xs">
            {space && target ? (
              <>
                <span className="shrink-0">Add to</span>
                <span
                  key={target}
                  className="text-foreground animate-in fade-in-0 min-w-0 truncate font-medium duration-200"
                >
                  {space.name}
                  {targetName && ` › ${targetName}`}
                </span>
              </>
            ) : (
              "Pick a space"
            )}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => space && target && void add(space, target)}
            disabled={!space || !target || access === "no" || linked || busy}
          >
            {busy ? "Adding…" : linked ? "Already there" : access === "ask" ? "Ask to add" : "Add"}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-1 flex-col sm:border-r">
        {spaces.length > 5 && (
          <div className="relative border-b p-3">
            <MagnifyingGlassIcon
              size={14}
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 -translate-y-1/2"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a space"
              aria-label="Find a space"
              className="h-8 rounded-lg pl-8 text-sm"
            />
          </div>
        )}
        {err && <div className="text-destructive px-4 pt-3 text-xs">{err}</div>}
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {spaces.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <div className="bg-muted ring-border/60 grid size-14 place-items-center rounded-2xl ring-1">
                  <UsersThreeIcon size={28} className="text-muted-foreground" />
                </div>
                <div className="text-sm font-medium">No spaces yet</div>
                <p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
                  A space is a drive you share with a group. Make one, and you can add to it from here.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onClose()
                    navigate("/spaces")
                  }}
                >
                  Go to Spaces
                </Button>
              </div>
            ) : shown.length === 0 ? (
              <div className="text-muted-foreground p-6 text-center text-xs">No space called “{query.trim()}”.</div>
            ) : (
              shown.map((s) => {
                const a = accessIn(s, me)
                return (
                  <button
                    key={s.id}
                    disabled={a === "no"}
                    onClick={() => pick(s)}
                    onDoubleClick={() => a !== "no" && void add(s, s.rootFolderId)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50",
                      // Full primary is "selected" here, so hover stays dimmer.
                      selected === s.id
                        ? "border-primary bg-primary/8"
                        : "enabled:hover:border-primary/40 enabled:hover:bg-accent/30 border-transparent"
                    )}
                  >
                    <SpaceLogo space={s} size={36} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{s.name}</span>
                        {s.pinned && <PushPinIcon size={11} weight="fill" className="text-muted-foreground shrink-0" />}
                        {s.isPublic && <GlobeIcon size={11} weight="fill" className="text-primary shrink-0" />}
                      </span>
                      <span className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                        {s.members.length > 0 && (
                          <span className="flex -space-x-1.5">
                            {s.members.slice(0, 4).map((m) => (
                              <Face key={m.userId} m={m} className="ring-popover size-5 ring-2" />
                            ))}
                          </span>
                        )}
                        {s.members.length === 0
                          ? "Only you"
                          : `${s.members.length} member${s.members.length === 1 ? "" : "s"}`}
                      </span>
                    </span>
                    <Badge variant={a === "owner" ? "default" : "muted"} className="shrink-0">
                      {ACCESS[a].label}
                    </Badge>
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* The space itself: who's there, what you may do, where in it the link goes. */}
      <aside className="bg-muted/20 hidden w-72 shrink-0 flex-col sm:flex">
        {!space || !access ? (
          <div className="animate-in fade-in-0 flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center duration-300 motion-reduce:animate-none">
            <div className="bg-muted ring-border/60 grid size-14 place-items-center rounded-2xl ring-1">
              <LinkSimpleIcon size={26} className="text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">Pick a space</div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              See who's in it and where the link will go before you add anything. The original always stays in
              your drive.
            </p>
          </div>
        ) : (
          <div
            key={space.id}
            className="animate-in fade-in-0 slide-in-from-right-2 flex min-h-0 flex-1 flex-col duration-200 motion-reduce:animate-none"
          >
            <div className="border-b p-4">
              <SpaceLogo space={space} size={44} />
              <div className="font-heading mt-2 leading-snug font-medium wrap-anywhere">{space.name}</div>
              <div className="text-muted-foreground mt-0.5 text-xs leading-snug">{ACCESS[access].line}</div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {/* One line: who'll see it matters, but less than where it goes. */}
              {space.members.length > 0 && (
                <div className="flex items-center gap-2.5 border-b px-4 py-3">
                  <span className="flex shrink-0 -space-x-1.5">
                    {space.members.slice(0, 4).map((m) => (
                      <Face key={m.userId} m={m} className="ring-popover size-6 ring-2" />
                    ))}
                  </span>
                  <span className="text-muted-foreground min-w-0 text-xs leading-snug">
                    {/* "Aisha, Ben and Chen", or "…and 4 more" past three. */}
                    {new Intl.ListFormat(undefined, { type: "conjunction" }).format([
                      ...space.members.slice(0, 3).map((m) => (m.userId === me ? "You" : m.name)),
                      ...(space.members.length > 3 ? [`${space.members.length - 3} more`] : []),
                    ])}
                  </span>
                </div>
              )}
              <div className="p-2">
                <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[10px] font-medium tracking-wide uppercase">
                  Put it in
                </div>
                {!top ? (
                  <Skeleton widths={[70, 50, 60]} />
                ) : (
                  [
                    { id: space.rootFolderId, name: "Top of the space", folder: undefined },
                    ...[...top.folders]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((f) => ({ id: f.id, name: f.name, folder: f })),
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTarget(t.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors duration-100",
                        target === t.id ? "bg-primary/12 ring-primary/50 ring-1 ring-inset" : "hover:bg-accent/60"
                      )}
                    >
                      {t.folder ? <FolderGlyph node={t.folder} size={14} /> : <SpaceLogo space={space} size={14} />}
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      {target === t.id && (
                        <CheckIcon size={12} className="text-primary animate-in zoom-in-50 shrink-0 duration-150" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
            <div className="space-y-2 border-t p-3">
              {linked ? (
                <Note tone="good" icon={<CheckCircleIcon size={14} weight="fill" />}>
                  Already linked here. Nothing to add.
                </Note>
              ) : sameName ? (
                <Note tone="warn" icon={<WarningIcon size={14} weight="fill" />}>
                  A folder named “{displayName}” is already here.
                </Note>
              ) : null}
              <Note tone="info" icon={<LinkSimpleIcon size={14} />}>
                {single?.type === "folder"
                  ? "Its folders are made in the space and its files linked into them. The originals stay in your drive."
                  : single
                    ? "A link, not a copy: it stays in your drive, and the space sees it as it is there."
                    : "Links, not copies: the originals stay in your drive."}
              </Note>
            </div>
          </div>
        )}
      </aside>
    </Modal>
  )
}
