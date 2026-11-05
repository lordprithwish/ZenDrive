import { Fragment, useEffect, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import {
  ArrowRightIcon,
  CaretRightIcon,
  DownloadIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderSimpleDashedIcon,
  HourglassMediumIcon,
  LinkBreakIcon,
  LinkIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { formatBytes, formatDate, relativeTime } from "@/lib/format"
import { apiUrl } from "@/lib/config"
import { iconFor } from "@/lib/fileIcon"
import { FileViewer } from "@/components/FilePreview"
import type { Breadcrumb, FileItem, Folder } from "@/lib/types"
import { HoverName } from "@/components/HoverName"

function ShareShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 backdrop-blur sm:px-6">
        <Link
          to="/landing"
          title="About DarkDrive"
          className="hover:text-primary flex items-center gap-2 transition-colors"
        >
          <img
            src="/DarkDrive.png"
            alt="DarkDrive"
            className="h-7 w-7 rounded-md"
          />
          <span className="text-base font-semibold tracking-tight">
            DarkDrive
          </span>
          <span className="bg-accent text-accent-foreground ml-2 hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex">
            <LinkIcon size={11} /> Shared link
          </span>
        </Link>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/" />}>
          Open DarkDrive
          <ArrowRightIcon size={14} />
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <footer className="text-muted-foreground border-t px-4 py-3 text-center text-xs sm:px-6">
        Shared via{" "}
        <Link
          to="/landing"
          className="text-foreground font-medium hover:underline"
        >
          DarkDrive
        </Link>
      </footer>
    </div>
  )
}

type SharedFolder = Folder & { fileCount: number; folderCount: number }
type Resolved =
  | { type: "FILE"; permission: "VIEW" | "EDIT"; file: FileItem }
  | {
      type: "FOLDER"
      permission: "VIEW" | "EDIT"
      /** Whether the link opens the folders inside the shared one: when not, none are listed. */
      includeSubfolders: boolean
      folder: Folder
      /** From the shared folder down to the one shown. */
      breadcrumbs: Breadcrumb[]
      folders: SharedFolder[]
      files: FileItem[]
    }

function shareInlineUrl(token: string, fileId?: string, password?: string) {
  const params = new URLSearchParams({ inline: "1" })
  if (password) params.set("password", password)
  return apiUrl(
    `/api/shares/${token}/download${fileId ? `/${fileId}` : ""}?${params}`
  )
}

function shareDownloadUrl(token: string, fileId?: string, password?: string) {
  const params = new URLSearchParams()
  if (password) params.set("password", password)
  const qs = params.toString()
  return apiUrl(
    `/api/shares/${token}/download${fileId ? `/${fileId}` : ""}${qs ? `?${qs}` : ""}`
  )
}

// A file's kind as people say it: its extension, else the second half of its type.
const kindOf = (f: FileItem) =>
  (/\.([a-z0-9]{1,6})$/i.exec(f.name)?.[1] ?? (f.mimeType.split("/")[1] || "file")).toUpperCase()
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
// Each row arrives a beat after the one above it, capped so a long folder doesn't keep anyone waiting.
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 14) * 25}ms`, animationFillMode: "backwards" as const })
const sectionLabel = "text-muted-foreground px-1 text-[11px] font-medium tracking-wide uppercase"

// The link's states before there's anything to show: one card, centred.
function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-4">
      <div className="bg-card animate-in fade-in-0 zoom-in-97 w-full max-w-sm rounded-3xl border p-6 text-center shadow-xl shadow-black/10 duration-300 motion-reduce:animate-none dark:shadow-black/40">
        <div className="bg-muted text-muted-foreground ring-border/60 mx-auto grid size-14 place-items-center rounded-2xl ring-1">
          {icon}
        </div>
        <h1 className="font-heading mt-4 text-lg font-medium">{title}</h1>
        <div className="text-muted-foreground mt-1.5 text-sm">{children}</div>
      </div>
    </div>
  )
}

export function SharePage() {
  const { token } = useParams<{ token: string }>()
  // The folder open under a shared folder, kept in the address so Back and a reload work.
  const [params, setParams] = useSearchParams()
  const sub = params.get("f") ?? undefined
  const [data, setData] = useState<Resolved | null>(null)
  const [pwPrompt, setPwPrompt] = useState(false)
  const [pwWrong, setPwWrong] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FileItem | null>(null)
  const [query, setQuery] = useState("")

  async function resolve(pw?: string) {
    const res = await fetch(apiUrl(`/api/shares/resolve/${token}`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(pw && { password: pw }), ...(sub && { folderId: sub }) }),
    })
    if (res.status === 401) {
      setPwPrompt(true)
      setPwWrong(!!pw)
      return
    }
    // A folder that's gone, or no longer in the link: back to the shared folder itself.
    if (res.status === 404 && sub) {
      setParams({}, { replace: true })
      return
    }
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "failed")
      return
    }
    setData(await res.json())
    setPwPrompt(false)
    setQuery("")
  }

  useEffect(() => {
    void resolve(password || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sub])

  if (error)
    return (
      <ShareShell>
        {error === "expired" ? (
          <Notice icon={<HourglassMediumIcon size={28} />} title="This link has expired">
            Ask whoever sent it for a fresh one.
          </Notice>
        ) : (
          <Notice icon={<LinkBreakIcon size={28} />} title="This link doesn't work">
            It may have been turned off, or the address got cut short. Check it with whoever sent it.
          </Notice>
        )}
      </ShareShell>
    )

  if (pwPrompt)
    return (
      <ShareShell>
        <Notice icon={<LockSimpleIcon size={28} />} title="This link is protected">
          Enter the password that came with it.
          <form
            className="text-foreground mt-4 space-y-2 text-left"
            onSubmit={(e) => {
              e.preventDefault()
              void resolve(password)
            }}
          >
            <Input
              type="password"
              autoFocus
              aria-label="Password"
              aria-invalid={pwWrong}
              className="rounded-xl"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setPwWrong(false)
              }}
            />
            {pwWrong && (
              <p role="alert" className="text-destructive animate-in fade-in-0 text-xs">
                That password didn't work.
              </p>
            )}
            <Button type="submit" className="w-full" disabled={!password}>
              Unlock
            </Button>
          </form>
        </Notice>
      </ShareShell>
    )

  if (!data)
    return (
      <ShareShell>
        <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-10 sm:px-6">
          <div className="bg-muted mb-8 h-14 w-64 animate-pulse rounded-2xl" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-muted h-12 animate-pulse rounded-xl" />
          ))}
        </div>
      </ShareShell>
    )

  if (data.type === "FILE") {
    const f = data.file
    return (
      <ShareShell>
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 p-4 sm:p-6">
          <div className="animate-in fade-in-0 flex items-center justify-between gap-3 duration-300">
            <div className="flex min-w-0 items-center gap-3">
              <div className="bg-muted grid size-11 shrink-0 place-items-center rounded-xl">
                {iconFor(f.mimeType, 24, f.name)}
              </div>
              <div className="min-w-0">
                <h1 className="font-heading min-w-0 truncate text-lg font-medium">
                  <HoverName as="span" name={f.name} className="truncate" />
                </h1>
                <div className="text-muted-foreground text-sm">
                  {kindOf(f)} · {formatBytes(f.size)}
                </div>
              </div>
            </div>
            <Button
              nativeButton={false}
              render={<a href={shareDownloadUrl(token!, undefined, password)} />}
              className="shrink-0"
            >
              <DownloadIcon size={16} /> Download
            </Button>
          </div>
          <div className="bg-muted grid min-h-0 flex-1 place-items-center overflow-hidden rounded-2xl border">
            <FileViewer file={f} src={shareInlineUrl(token!, undefined, password)} layout="fill" />
          </div>
        </div>
      </ShareShell>
    )
  }

  const q = query.trim().toLowerCase()
  const folders = q ? data.folders.filter((f) => f.name.toLowerCase().includes(q)) : data.folders
  const files = q ? data.files.filter((f) => f.name.toLowerCase().includes(q)) : data.files
  const total = data.files.reduce((n, f) => n + f.size, 0)
  const open = (id: string) => setParams(id === data.breadcrumbs[0]?.id ? {} : { f: id })
  const tint = data.folder.color ?? "var(--primary)"

  return (
    <ShareShell>
      <div
        key={data.folder.id}
        className="animate-in fade-in-0 mx-auto w-full max-w-5xl px-4 py-8 duration-300 motion-reduce:animate-none sm:px-6"
      >
        {data.breadcrumbs.length > 1 && (
          <nav aria-label="Folders" className="text-muted-foreground mb-5 flex flex-wrap items-center gap-1 text-sm">
            {data.breadcrumbs.map((b, i) =>
              i < data.breadcrumbs.length - 1 ? (
                <Fragment key={b.id}>
                  <button onClick={() => open(b.id)} className="hover:text-foreground rounded-md px-1 transition-colors">
                    {b.name}
                  </button>
                  <CaretRightIcon size={12} />
                </Fragment>
              ) : (
                <span key={b.id} className="text-foreground px-1 font-medium">
                  {b.name}
                </span>
              )
            )}
          </nav>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <div
            className="grid size-14 shrink-0 place-items-center rounded-2xl"
            style={{ backgroundColor: `color-mix(in oklab, ${tint} 14%, transparent)` }}
          >
            <FolderOpenIcon size={30} weight="fill" style={{ color: tint }} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-heading truncate text-2xl font-medium">
              <HoverName name={data.folder.name} className="truncate" />
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {[
                data.folders.length > 0 && plural(data.folders.length, "folder"),
                plural(data.files.length, "file"),
                data.files.length > 0 && formatBytes(total),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {data.folders.length + data.files.length > 8 && (
            <div className="relative w-full sm:w-60">
              <MagnifyingGlassIcon
                size={14}
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find in this folder"
                aria-label="Find in this folder"
                className="h-9 rounded-xl pl-8"
              />
            </div>
          )}
        </div>

        {folders.length > 0 && (
          <section className="mt-8">
            <h2 className={sectionLabel}>Folders</h2>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
              {folders.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => open(f.id)}
                  style={stagger(i)}
                  className="bg-card hover:border-primary animate-in fade-in-0 slide-in-from-bottom-1 flex items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-300 motion-reduce:animate-none"
                >
                  <FolderIcon
                    size={26}
                    weight="fill"
                    style={{ color: f.color || undefined }}
                    className={f.color ? "shrink-0" : "text-primary shrink-0"}
                  />
                  <span className="min-w-0 flex-1">
                    <HoverName name={f.name} className="block truncate text-sm font-medium" />
                    <span className="text-muted-foreground block text-xs">
                      {f.fileCount + f.folderCount === 0
                        ? "Empty"
                        : [f.folderCount > 0 && plural(f.folderCount, "folder"), f.fileCount > 0 && plural(f.fileCount, "file")]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                  </span>
                  <CaretRightIcon size={14} className="text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </section>
        )}

        {files.length > 0 && (
          <section className="mt-8">
            <h2 className={sectionLabel}>Files</h2>
            <div className="bg-card mt-2 overflow-hidden rounded-2xl border">
              <div className="text-muted-foreground hidden grid-cols-[1fr_4.5rem_5.5rem_6rem_2rem] gap-3 border-b px-4 py-2 text-[11px] font-medium tracking-wide uppercase sm:grid">
                <span>Name</span>
                <span>Type</span>
                <span className="text-right">Size</span>
                <span>Added</span>
                <span />
              </div>
              {files.map((f, i) => (
                // The whole row opens the file; the download button sits above that.
                <div
                  key={f.id}
                  style={stagger(folders.length + i)}
                  className="hover:bg-accent/40 animate-in fade-in-0 slide-in-from-bottom-1 relative grid grid-cols-[1fr_2rem] items-center gap-3 border-b px-4 py-2 transition-colors duration-300 last:border-b-0 motion-reduce:animate-none sm:grid-cols-[1fr_4.5rem_5.5rem_6rem_2rem]"
                >
                  <button
                    onClick={() => setPreview(f)}
                    className="flex min-w-0 items-center gap-3 text-left after:absolute after:inset-0"
                  >
                    <span className="bg-muted grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg">
                      {f.mimeType.startsWith("image/") ? (
                        <img
                          src={shareInlineUrl(token!, f.id, password)}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        iconFor(f.mimeType, 20, f.name)
                      )}
                    </span>
                    <span className="min-w-0">
                      <HoverName name={f.name} className="relative z-10 block truncate text-sm font-medium" />
                      <span className="text-muted-foreground block text-xs sm:hidden">
                        {kindOf(f)} · {formatBytes(f.size)}
                      </span>
                    </span>
                  </button>
                  <span className="text-muted-foreground hidden truncate text-xs sm:block">{kindOf(f)}</span>
                  <span className="text-muted-foreground hidden text-right text-xs tabular-nums sm:block">
                    {formatBytes(f.size)}
                  </span>
                  <span className="text-muted-foreground hidden text-xs sm:block">{relativeTime(f.createdAt)}</span>
                  <a
                    href={shareDownloadUrl(token!, f.id, password)}
                    aria-label={`Download ${f.name}`}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent relative z-10 grid size-8 place-items-center justify-self-end rounded-lg transition-colors"
                  >
                    <DownloadIcon size={16} />
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {folders.length + files.length === 0 &&
          (q ? (
            <p className="text-muted-foreground mt-12 text-center text-sm">Nothing called “{query.trim()}” here.</p>
          ) : (
            <div className="mt-12 flex flex-col items-center gap-3 text-center">
              <div className="bg-muted ring-border/60 grid size-14 place-items-center rounded-2xl ring-1">
                <FolderSimpleDashedIcon size={28} className="text-muted-foreground" />
              </div>
              <div className="text-sm font-medium">This folder is empty</div>
              <p className="text-muted-foreground text-xs">Nothing has been put in it yet.</p>
            </div>
          ))}

        {preview && (
          <SharedFileModal
            file={preview}
            token={token!}
            password={password}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </ShareShell>
  )
}

function SharedFileModal({
  file,
  token,
  password,
  onClose,
}: {
  file: FileItem
  token: string
  password: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* A fixed-size stage the viewer fills, so the same markup works as a
          row on a wide window and, below `lg`, as a column with the details
          on top — where the close button already sits. */}
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 lg:flex-row">
        <div className="bg-muted flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
          <FileViewer file={file} src={shareInlineUrl(token, file.id, password)} layout="fill" />
        </div>
        <ScrollArea className="max-h-[40%] shrink-0 border-b max-lg:order-first lg:max-h-none lg:w-72 lg:border-b-0 lg:border-l">
          <aside className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2 pr-8">
              <DialogTitle className="min-w-0 flex-1 text-base leading-snug font-semibold">
                <HoverName as="span" name={file.name} className="line-clamp-2" />
              </DialogTitle>
            </div>
            <a
              href={shareDownloadUrl(token, file.id, password)}
              className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
            >
              <DownloadIcon size={14} /> Download
            </a>
            <div className="text-muted-foreground border-t pt-3 text-sm">
              <div>{file.mimeType || "unknown"}</div>
              <div>{formatBytes(file.size)}</div>
              <div>Added {formatDate(file.createdAt)}</div>
            </div>
          </aside>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
