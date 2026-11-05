import { useEffect, useState } from "react"
import {
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  GlobeHemisphereWestIcon,
  HourglassMediumIcon,
  KeyIcon,
  LinkSimpleIcon,
  LockSimpleIcon,
  QrCodeIcon,
  ShareNetworkIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import { apiGet, apiJson } from "@/lib/api"
import { WEB_ORIGIN } from "@/lib/config"
import { relativeTime } from "@/lib/format"
import { cn } from "@workspace/ui/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { PopConfirm } from "@workspace/ui/components/popconfirm"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Modal } from "@/components/Modal"
import { DateTimePicker } from "@/components/DateTimePicker"
import { HoverName } from "@/components/HoverName"
import { CanSelects, Requests } from "@/components/MemberCan"
import { QrCode } from "@/components/TempSessionsCard"
import type { MemberCan, MemberRequest, Share } from "@/lib/types"
import { useAuth } from "@/store/auth"
import { toast } from "@/store/toast"

type Props = {
  open: boolean
  onClose: () => void
  resourceType: "FILE" | "FOLDER"
  resourceId: string
  resourceName: string
  /** A folder's parent, where it's known: one of the user's own synced folders can be shared with people too. */
  parentId?: string | null
}

type Member = MemberCan & { id: string; name: string; email: string; avatarUrl?: string | null }

// What the API says when it won't share a folder (apps/api routes/sync.ts).
const SHARE_ERRORS: Record<string, string> = {
  user_not_found: "No DarkDrive account uses that email.",
  already_owner: "That's your own account.",
}

// The people one of the user's synced folders is shared with (apps/api
// routes/sync.ts), what each may do in it, and what those who have to ask are
// waiting on. Each keeps the folder on their own computers with the desktop
// app.
function SyncMembers({ folderId }: { folderId: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [requests, setRequests] = useState<MemberRequest[]>([])
  const [email, setEmail] = useState("")
  const [can, setCan] = useState<MemberCan>({ canUpload: "YES", canDelete: "YES" })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const folder = `/api/sync/folders/${folderId}`
  const base = `${folder}/members`
  const load = async () => {
    const [m, r] = await Promise.all([
      apiGet<{ members: Member[] }>(base),
      apiGet<{ requests: MemberRequest[] }>(`${folder}/requests`),
    ])
    setMembers(m.members)
    setRequests(r.requests)
  }
  const failed = () => toast.error("That didn't go through. Try again.")
  // Sharing again with someone already there changes what they may do.
  const change = (m: Member, patch: Partial<MemberCan>) =>
    apiJson(base, "POST", { email: m.email, ...patch }).then(load, failed)
  const answer = (ids: string[], approve: boolean) =>
    apiJson(`${folder}/requests`, "POST", { ids, approve }).then(load, failed)

  useEffect(() => {
    void load()
  }, [folderId])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await apiJson(base, "POST", { email: email.trim(), ...can })
      setEmail("")
      await load()
    } catch (err) {
      setError(SHARE_ERRORS[(err as Error).message] ?? "Couldn't share the folder. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b p-4">
      <div className="text-sm font-semibold">Sync with people</div>
      <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
        They keep this folder on their own computers. What each may change in it is up to you:
        "Ask me first" holds what they add, or want deleted, until you agree.
      </p>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input
          type="email"
          required
          placeholder="Their DarkDrive email"
          aria-label="Their DarkDrive email"
          className="min-w-0 flex-1 rounded-xl"
          aria-invalid={!!error}
          aria-describedby="sync-share-error"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError("")
          }}
        />
        <Button type="submit" disabled={busy}>
          Share
        </Button>
        <CanSelects className="basis-full" value={can} onChange={(patch) => setCan({ ...can, ...patch })} />
      </form>
      <p id="sync-share-error" role="alert" className="text-destructive mt-1.5 text-xs empty:hidden">
        {error}
      </p>
      {members.length > 0 && (
        <ul className="mt-1 flex flex-col">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0 last:pb-0">
              <Avatar className="h-7 w-7 border">
                {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                <AvatarFallback className="text-xs font-semibold uppercase">
                  {m.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.name}</div>
                <div className="text-muted-foreground truncate text-xs">{m.email}</div>
              </div>
              <PopConfirm
                title={`Stop sharing with ${m.name}?`}
                description="Their computers keep their copies, which stop syncing."
                confirmLabel="Stop sharing"
                destructive
                onConfirm={() => apiJson(`${base}/${m.id}`, "DELETE").then(load)}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    title="Stop sharing"
                    aria-label={`Stop sharing with ${m.name}`}
                  >
                    <XIcon size={14} />
                  </Button>
                }
              />
              <CanSelects className="basis-full pl-10" value={m} onChange={(patch) => change(m, patch)} />
            </li>
          ))}
        </ul>
      )}
      {requests.length > 0 && (
        <div className="mt-4">
          <Requests requests={requests} onAnswer={answer} />
        </div>
      )}
    </div>
  )
}

type Expiry = "never" | "1" | "7" | "30" | "custom"
const EXPIRY: [Expiry, string][] = [
  ["never", "Never"],
  ["1", "1 day"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["custom", "Pick…"],
]

const isExpired = (s: Share) => !!s.expiresAt && new Date(s.expiresAt) < new Date()
const urlOf = (s: { token: string }) => `${WEB_ORIGIN}/s/${s.token}`

// "Expires in 5h", "Expires in 3d", or that it doesn't.
function expiryText(iso?: string | null) {
  if (!iso) return "Never expires"
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "Expired"
  const h = Math.max(1, Math.round(ms / 3600000))
  return h < 48 ? `Expires in ${h}h` : `Expires in ${Math.round(h / 24)}d`
}

// A row of choices where one is always on: lighter than a select for two to five options.
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-muted flex w-fit flex-wrap gap-0.5 rounded-lg p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-[color,background-color,box-shadow] duration-150",
            value === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function ShareDialog({ open, onClose, resourceType, resourceId, resourceName, parentId }: Props) {
  const synced = useAuth((s) => !!s.user && !!parentId && s.user.syncRootFolderId === parentId)
  const [shares, setShares] = useState<Share[]>([])
  const [permission, setPermission] = useState<"VIEW" | "EDIT">("VIEW")
  const [password, setPassword] = useState("")
  const [expiry, setExpiry] = useState<Expiry>("never")
  const [expiresAt, setExpiresAt] = useState("")
  /** A folder link's reach: the folder's own files, or everything under it too. */
  const [reach, setReach] = useState<"self" | "all">("self")
  const [loading, setLoading] = useState(false)
  /** The link whose copy button shows a tick for a moment. */
  const [copied, setCopied] = useState<string | null>(null)

  async function load() {
    const data = await apiGet<{ shares: Share[] }>(
      `/api/shares/for/${resourceType.toLowerCase()}/${resourceId}`
    )
    setShares(data.shares)
  }

  useEffect(() => {
    if (open) void load()
  }, [open, resourceId])

  async function copy(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600)
      return true
    } catch {
      return false
    }
  }

  // The API wants at least 4 characters; say so here rather than fail on create.
  const shortPassword = password.length > 0 && password.length < 4

  async function createLink() {
    const until =
      expiry === "never"
        ? undefined
        : expiry === "custom"
          ? expiresAt && new Date(expiresAt)
          : new Date(Date.now() + Number(expiry) * 86400000)
    setLoading(true)
    try {
      const s = await apiJson<{ id: string; token: string }>("/api/shares", "POST", {
        resourceType,
        resourceId,
        permission,
        password: password || undefined,
        expiresAt: until ? until.toISOString() : undefined,
        includeSubfolders: resourceType === "FOLDER" && reach === "all",
      })
      setPassword("")
      setExpiry("never")
      setExpiresAt("")
      await load()
      // A link is made to be sent: it's on the clipboard already.
      toast.success((await copy(s.id, urlOf(s))) ? "Link created and copied." : "Link created.")
    } catch {
      toast.error("Couldn't create the link.")
    } finally {
      setLoading(false)
    }
  }

  async function deleteShare(id: string) {
    await apiJson(`/api/shares/${id}`, "DELETE")
    await load()
  }

  const live = shares.filter((s) => !isExpired(s))
  // Working links first, newest first; expired ones after, until they're revoked.
  const sorted = [...shares].sort(
    (a, b) => Number(isExpired(a)) - Number(isExpired(b)) || b.createdAt.localeCompare(a.createdAt)
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      icon={<ShareNetworkIcon size={18} className="text-primary" />}
      title="Share"
      description={<HoverName name={resourceName} className="block truncate" />}
    >
      {synced && <SyncMembers folderId={resourceId} />}

      <div className="space-y-4 p-4">
        {/* Who can get in through a link, before anything else. */}
        <div
          key={live.length > 0 ? "open" : "closed"}
          className={cn(
            "animate-in fade-in-0 flex items-center gap-3 rounded-2xl border p-3 duration-300 motion-reduce:animate-none",
            live.length > 0 ? "border-primary/30 bg-primary/5" : "bg-muted/30"
          )}
        >
          <div
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl",
              live.length > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            {live.length > 0 ? (
              <GlobeHemisphereWestIcon size={20} weight="duotone" />
            ) : (
              <LockSimpleIcon size={20} weight="duotone" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {live.length > 0 ? "Open to anyone with the link" : "No links yet"}
            </div>
            <div className="text-muted-foreground text-xs">
              {live.length > 0
                ? `${live.length} working link${live.length === 1 ? "" : "s"}. Whoever has one can open it without signing in.`
                : "Make one below, and whoever you send it to can open it without signing in."}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border p-3">
          <div className="text-sm font-semibold">New link</div>
          <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2.5">
            {resourceType === "FOLDER" && (
              <>
                <span className="text-muted-foreground text-xs">Includes</span>
                <Segmented
                  label="Includes"
                  value={reach}
                  onChange={setReach}
                  options={[
                    ["self", "This folder only"],
                    ["all", "With subfolders"],
                  ]}
                />
                <span
                  key={reach}
                  className="text-muted-foreground animate-in fade-in-0 col-start-2 -mt-1 text-[11px] duration-200"
                >
                  {reach === "all"
                    ? "Opens every folder inside it too, as they are now and whatever goes in them later."
                    : "Only the files right in this folder. Folders inside it stay private."}
                </span>
              </>
            )}
            <span className="text-muted-foreground text-xs">Access</span>
            <Segmented
              label="Access"
              value={permission}
              onChange={setPermission}
              options={[
                ["VIEW", "View"],
                ["EDIT", "Edit (download)"],
              ]}
            />
            <span className="text-muted-foreground text-xs">Expires</span>
            <Segmented label="Expires" value={expiry} onChange={setExpiry} options={EXPIRY} />
            {expiry === "custom" && (
              <div className="animate-in fade-in-0 slide-in-from-top-1 col-start-2 duration-150 motion-reduce:animate-none">
                <DateTimePicker value={expiresAt} onChange={setExpiresAt} className="w-full" />
              </div>
            )}
            <span className="text-muted-foreground text-xs">Password</span>
            <div className="relative">
              <KeyIcon
                size={14}
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              />
              <Input
                type="password"
                placeholder="Optional"
                aria-label="Password"
                aria-invalid={shortPassword}
                className="h-8 rounded-lg pl-8 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {shortPassword && (
              <span className="text-destructive col-start-2 -mt-1 text-xs">At least 4 characters.</span>
            )}
          </div>
          <Button onClick={createLink} disabled={loading || shortPassword} className="w-full">
            <LinkSimpleIcon size={16} />
            {loading ? "Creating…" : "Create link"}
          </Button>
        </div>

        {sorted.length > 0 && (
          <div className="space-y-2">
            <div className="text-muted-foreground px-1 text-[10px] font-medium tracking-wide uppercase">
              Links · {sorted.length}
            </div>
            <ul className="space-y-2">
              {sorted.map((s) => {
                const url = urlOf(s)
                const expired = isExpired(s)
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "animate-in fade-in-0 slide-in-from-top-1 rounded-xl border p-2.5 duration-200 motion-reduce:animate-none",
                      expired && "opacity-60"
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <Input
                        readOnly
                        value={url}
                        aria-label="Share link"
                        onFocus={(e) => e.currentTarget.select()}
                        className="mr-1 h-8 min-w-0 flex-1 rounded-lg font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy link"
                        onClick={() =>
                          copy(s.id, url).then(
                            (ok) => ok || toast.error("Couldn't copy. Select the link and copy it.")
                          )
                        }
                      >
                        {copied === s.id ? (
                          <CheckIcon size={14} className="text-success animate-in zoom-in-50 duration-200" />
                        ) : (
                          <CopyIcon size={14} />
                        )}
                      </Button>
                      <Popover>
                        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Show QR code" />}>
                          <QrCodeIcon size={14} />
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-auto p-3">
                          <QrCode value={url} label="QR code of the share link" className="size-40 rounded-lg" />
                          <div className="text-muted-foreground mt-2 text-center text-xs">Scan to open it on a phone</div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open link"
                        nativeButton={false}
                        render={<a href={url} target="_blank" rel="noreferrer" />}
                      >
                        <ArrowSquareOutIcon size={14} />
                      </Button>
                      <PopConfirm
                        title="Revoke this link?"
                        description="Anyone using it loses access right away."
                        confirmLabel="Revoke"
                        destructive
                        onConfirm={() => deleteShare(s.id)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Revoke link"
                          >
                            <TrashIcon size={14} />
                          </Button>
                        }
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="muted">{s.permission === "EDIT" ? "Edit" : "View"}</Badge>
                      {s.resourceType === "FOLDER" && (
                        <Badge variant="muted">{s.includeSubfolders ? "With subfolders" : "Folder only"}</Badge>
                      )}
                      {s.hasPassword && (
                        <Badge variant="muted">
                          <KeyIcon size={10} /> Password
                        </Badge>
                      )}
                      <Badge variant={expired ? "destructive" : "muted"}>
                        <HourglassMediumIcon size={10} /> {expiryText(s.expiresAt)}
                      </Badge>
                      <span className="text-muted-foreground ml-auto text-[11px]">
                        Created {relativeTime(s.createdAt)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
