import { Suspense, lazy, useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  XIcon,
  DownloadIcon,
  InfoIcon,
  CaretLeftIcon,
  CaretRightIcon,
  FrameCornersIcon,
  CornersInIcon,
} from "@phosphor-icons/react"
import type { FileItem, SubtitleTrack, AudioTrack } from "@/lib/types"
import { apiUrl } from "@/lib/config"
import { apiGet, apiJson } from "@/lib/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { formatBytes, formatDate } from "@/lib/format"
import { DarkPlayer } from "./player"
import { AudioPlayer } from "@/components/AudioPlayer"
import { HoverName } from "@/components/HoverName"
import { ZoomableImage } from "@/components/ZoomableImage"

const LazyPdfViewer = lazy(async () => {
  const module = await import("@/components/PdfViewer")
  return { default: module.PdfViewer }
})

// A phone, half a screen, or a short window: too little room to sit the media
// beside a details panel, so the viewer takes the whole window and the details
// open as a sheet.
const COMPACT_QUERY = "(max-width: 1023px), (max-height: 559px)"

const PAGER_BUTTON =
  "rounded-md p-1.5 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"

// Controls that sit on the picture: dark glass with a lit top edge, so they
// read on a bright frame and a dark one alike.
const GLASS_BUTTON =
  "grid size-9 place-items-center rounded-full bg-black/45 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/65 active:scale-95"

// What cinema mode is for: things you watch or look at, not read.
function canCinema(mimeType: string) {
  return mimeType.startsWith("video/") || mimeType.startsWith("image/")
}

export function FilePreview({
  file,
  onClose,
  items,
  onNavigate,
}: {
  file: FileItem | null
  onClose: () => void
  items?: FileItem[]
  onNavigate?: (file: FileItem) => void
}) {
  const [officeProviderState, setOfficeProviderState] = useState<{
    fileId: string | null
    provider: OfficeProvider
  }>({ fileId: null, provider: "office" })
  const [pdfFocusState, setPdfFocusState] = useState<{
    fileId: string | null
    focused: boolean
  }>({ fileId: null, focused: false })
  const [infoState, setInfoState] = useState<{
    fileId: string | null
    show: boolean
  }>({ fileId: null, show: false })
  const showInfo = infoState.fileId === file?.id && infoState.show
  const setShowInfo = (show: boolean) => {
    if (file) setInfoState({ fileId: file.id, show })
  }
  const [compact, setCompact] = useState(
    () => window.matchMedia(COMPACT_QUERY).matches
  )
  // Cinema mode: the video or image takes the whole window, with nothing
  // around it. Not fullscreen: the browser and the OS stay as they are. Kept
  // while paging between files, dropped when the preview closes.
  const [cinemaOn, setCinemaOn] = useState(false)
  if (!file && cinemaOn) setCinemaOn(false)
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Track lists for the video controls in the Properties panel. Both are
  // fetched here rather than inside the player so the sidebar owns the
  // selection and the player just renders what it's told.
  const [audioTracksState, setAudioTracksState] = useState<{
    fileId: string | null
    tracks: AudioTrack[]
  }>({ fileId: null, tracks: [] })
  const [subtitleTracksState, setSubtitleTracksState] = useState<{
    fileId: string | null
    tracks: SubtitleTrack[]
  }>({ fileId: null, tracks: [] })
  // Overrides file.audioTrackIndex once the user picks a track this session,
  // so the Properties panel reflects the change immediately (no refetch).
  const [audioPick, setAudioPick] = useState<{
    fileId: string | null
    index: number | null
  }>({ fileId: null, index: null })
  // Subtitle choice is view-only state (not persisted): index into the
  // subtitle track list, or null for off.
  const [subtitlePick, setSubtitlePick] = useState<{
    fileId: string | null
    index: number | null
  }>({ fileId: null, index: null })

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY)
    const handler = (e: MediaQueryListEvent) => setCompact(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  // Move focus into the preview and hand it back to whatever opened it, so a
  // keyboard or screen reader lands in the dialog rather than behind it.
  // ponytail: Tab can still walk out to the page underneath. Trapping it needs
  // this to become a Base UI Dialog, which means untangling Escape from the
  // player and the PDF viewer first.
  const open = !!file
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => opener?.focus()
  }, [open, compact, cinemaOn])

  const handleKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!file) return

    if (e.key === "ArrowLeft" && items && onNavigate) {
      const idx = items.findIndex((f) => f.id === file.id)
      if (idx > 0) {
        e.preventDefault()
        onNavigate(items[idx - 1])
      }
      return
    }
    if (e.key === "ArrowRight" && items && onNavigate) {
      const idx = items.findIndex((f) => f.id === file.id)
      if (idx >= 0 && idx < items.length - 1) {
        e.preventDefault()
        onNavigate(items[idx + 1])
      }
      return
    }

    // T, as in theatre mode on every video site. Not while a menu has the
    // keyboard: there a letter jumps to the option that starts with it.
    if (
      e.key.toLowerCase() === "t" &&
      !(e.ctrlKey || e.metaKey || e.altKey) &&
      canCinema(file.mimeType) &&
      !(e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, [role="listbox"], [role="combobox"]'))
    ) {
      e.preventDefault()
      setCinemaOn(!cinemaOn)
      return
    }

    if (e.key !== "Escape") return

    if (showInfo) {
      e.preventDefault()
      setShowInfo(false)
      return
    }

    if (cinemaOn && canCinema(file.mimeType)) {
      e.preventDefault()
      setCinemaOn(false)
      return
    }

    if (
      isPdfFile(file.mimeType, file.name) &&
      pdfFocusState.fileId === file.id &&
      pdfFocusState.focused
    ) {
      e.preventDefault()
      setPdfFocusState({ fileId: file.id, focused: false })
      return
    }

    onClose()
  })

  useEffect(() => {
    if (!file) return
    const onKey = (event: KeyboardEvent) => handleKeyDown(event)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [file])

  useEffect(() => {
    if (!file || !file.mimeType.startsWith("video/")) return
    let cancelled = false
    apiGet<{ tracks: AudioTrack[] }>(`/api/files/${file.id}/audio-tracks`)
      .then((data) => {
        if (!cancelled) setAudioTracksState({ fileId: file.id, tracks: data.tracks })
      })
      .catch(() => {
        if (!cancelled) setAudioTracksState({ fileId: file.id, tracks: [] })
      })
    apiGet<{ tracks: SubtitleTrack[] }>(`/api/files/${file.id}/subtitles`)
      .then((data) => {
        if (cancelled) return
        setSubtitleTracksState({
          fileId: file.id,
          tracks: data.tracks.map((t) => ({ ...t, src: apiUrl(t.src) })),
        })
      })
      .catch(() => {
        if (!cancelled) setSubtitleTracksState({ fileId: file.id, tracks: [] })
      })
    return () => {
      cancelled = true
    }
  }, [file])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }, [])

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current || !items || !onNavigate || !file) return
      const t = e.changedTouches[0]
      const dx = t.clientX - touchRef.current.x
      const dy = t.clientY - touchRef.current.y
      const dt = Date.now() - touchRef.current.t
      touchRef.current = null
      if (dt > 400 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5)
        return
      const idx = items.findIndex((f) => f.id === file.id)
      if (dx > 0 && idx > 0) onNavigate(items[idx - 1])
      else if (dx < 0 && idx >= 0 && idx < items.length - 1)
        onNavigate(items[idx + 1])
    },
    [items, onNavigate, file]
  )

  // Stable per file: the PDF viewer reports its focus mode from an effect
  // keyed on this callback, so a new one every render had the two components
  // re-rendering each other for as long as a PDF was open.
  const fileId = file?.id ?? null
  const handlePdfFocusModeChange = useCallback(
    (focused: boolean) => setPdfFocusState({ fileId, focused }),
    [fileId]
  )

  if (!file) return null

  const videoFile = file.mimeType.startsWith("video/")
  const cinemaFile = canCinema(file.mimeType)
  const cinema = cinemaOn && cinemaFile
  const audioTracks =
    audioTracksState.fileId === file.id ? audioTracksState.tracks : []
  const subtitleTracks =
    subtitleTracksState.fileId === file.id ? subtitleTracksState.tracks : []
  const audioIndex =
    audioPick.fileId === file.id ? audioPick.index : file.audioTrackIndex ?? null
  const subtitleIndex = subtitlePick.fileId === file.id ? subtitlePick.index : null
  // `items` feeds Select's trigger label; without it Base UI falls back to
  // stringifying the raw value (the track index).
  const audioItems: { value: number | null; label: string }[] = [
    {
      value: null,
      label:
        audioTracks.length === 0
          ? "No audio"
          : audioTracks.length === 1
            ? audioTracks[0].label
            : "Default",
    },
    ...(audioTracks.length > 1
      ? audioTracks.map((a) => ({ value: a.index, label: a.label }))
      : []),
  ]
  const subtitleItems: { value: number | null; label: string }[] = [
    { value: null, label: subtitleTracks.length ? "Off" : "None found" },
    ...subtitleTracks.map((t, i) => ({ value: i, label: t.label })),
  ]
  const selectAudio = (index: number | null) => {
    setAudioPick({ fileId: file.id, index })
    apiJson(`/api/files/${file.id}`, "PATCH", { audioTrackIndex: index }).catch(
      () => {}
    )
  }
  const selectSubtitle = (index: number | null) => {
    setSubtitlePick({ fileId: file.id, index })
  }
  const posterUrl = videoFile ? apiUrl(`/api/files/${file.id}/thumbnail`) : undefined
  const storyboardUrl = videoFile
    ? apiUrl(`/api/files/${file.id}/storyboard.vtt`)
    : undefined
  const startTime = file.playbackPositionSec ?? undefined
  const saveProgress = (sec: number) => {
    apiJson(`/api/files/${file.id}`, "PATCH", { playbackPositionSec: sec || null }).catch(
      () => {}
    )
  }

  const officeFile = isOfficeFile(file.mimeType, file.name)
  const pdfFile = isPdfFile(file.mimeType, file.name)
  const pdfFocusMode =
    !compact &&
    pdfFile &&
    pdfFocusState.fileId === file.id &&
    pdfFocusState.focused
  const officeProvider =
    officeFile && officeProviderState.fileId === file.id
      ? officeProviderState.provider
      : "office"
  const inlineSrc = apiUrl(`/api/files/${file.id}/download?inline=1`)
  const viewSrc =
    officeFile || pdfFile
      ? apiUrl(`/api/files/${file.id}/preview`)
      : inlineSrc
  const dlHref = apiUrl(`/api/files/${file.id}/download`)
  const viewerLayout: FileViewerLayout =
    compact || pdfFocusMode || cinema ? "fill" : "modal"

  const currentIndex = items
    ? items.findIndex((f) => f.id === file.id)
    : -1
  const hasPrev = currentIndex > 0
  const hasNext = items ? currentIndex < items.length - 1 : false
  const goPrev = () => {
    if (hasPrev && items && onNavigate) onNavigate(items[currentIndex - 1])
  }
  const goNext = () => {
    if (hasNext && items && onNavigate) onNavigate(items[currentIndex + 1])
  }
  const counter =
    items && items.length > 1 && currentIndex >= 0
      ? `${currentIndex + 1} / ${items.length}`
      : null
  // Lives in the chrome, not floating over the media, so it never covers a
  // small image or the details panel. Arrow keys and swipes page too.
  const pager = counter && (
    <div className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs tabular-nums">
      <button
        onClick={goPrev}
        disabled={!hasPrev}
        className={PAGER_BUTTON}
        aria-label="Previous file"
      >
        <CaretLeftIcon size={16} weight="bold" />
      </button>
      <span aria-live="polite">{counter}</span>
      <button
        onClick={goNext}
        disabled={!hasNext}
        className={PAGER_BUTTON}
        aria-label="Next file"
      >
        <CaretRightIcon size={16} weight="bold" />
      </button>
    </div>
  )

  const handleOfficeProviderChange = (provider: OfficeProvider) => {
    setOfficeProviderState({ fileId: file.id, provider })
  }

  // What the file is, at a glance, under its name. A flag shows only when
  // it's set: three rows of "No" told nobody anything.
  const ext = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1].toUpperCase()
  const meta = (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      {[ext, formatBytes(file.size)].filter(Boolean).join(" · ")}
      {file.isStarred && <Badge variant="muted">Starred</Badge>}
      {file.isHidden && <Badge variant="muted">Hidden</Badge>}
      {file.isTrashed && <Badge variant="destructive">In bin</Badge>}
    </div>
  )

  const download = (
    <a href={dlHref} className={buttonVariants({ size: "lg", className: "w-full" })}>
      <DownloadIcon weight="bold" /> Download
    </a>
  )

  // A track menu appears only when there's a track to choose; otherwise the
  // row just says what's playing.
  const details = (
    <div className="flex flex-col gap-4">
      {officeFile && (
        <Section title="Preview">
          <Info
            label="Viewer"
            value={
              <OfficeProviderSwitch
                provider={officeProvider}
                onChange={handleOfficeProviderChange}
              />
            }
          />
        </Section>
      )}
      {videoFile && (
        <Section title="Playback">
          <Info
            label="Audio"
            value={
              audioTracks.length < 2 ? (
                audioItems[0].label
              ) : (
                <Select
                  items={audioItems}
                  value={audioIndex}
                  onValueChange={(v) => selectAudio(v as number | null)}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Audio track">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {audioItems.map((a) => (
                      <SelectItem key={a.value ?? "default"} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            }
          />
          <Info
            label="Subtitles"
            value={
              subtitleTracks.length === 0 ? (
                subtitleItems[0].label
              ) : (
                <Select
                  items={subtitleItems}
                  value={subtitleIndex}
                  onValueChange={(v) => selectSubtitle(v as number | null)}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Subtitles">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subtitleItems.map((t) => (
                      <SelectItem key={t.value ?? "off"} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            }
          />
        </Section>
      )}
      <Section title="Details">
        <Info
          label="Type"
          value={
            // An Office type runs to seventy characters; the extension above
            // already says it in four.
            <span title={file.mimeType} className="block truncate">
              {file.mimeType || "—"}
            </span>
          }
        />
        <Info label="Added" value={formatDate(file.createdAt)} />
        <Info label="Modified" value={formatDate(file.updatedAt)} />
      </Section>
      <Section title="Reference">
        <Info label="ID" value={<Mono>{file.id}</Mono>} />
        <Info label="Folder" value={<Mono>{file.folderId}</Mono>} />
        {file.spaceId && <Info label="Space" value={<Mono>{file.spaceId}</Mono>} />}
        <Info label="Key" value={<Mono>{file.storageKey}</Mono>} />
      </Section>
    </div>
  )

  // One tree for every layout. The viewer keeps its place while the chrome
  // around it changes, so turning a tablet, resizing the window or entering
  // cinema mode restyles the player instead of remounting it — a remount
  // reloads the video and throws it back to where it started.
  //
  // On a wide window that chrome is two cards floating over the blurred page:
  // the media, and the details beside it.
  const full = compact || cinema
  return (
    <div
      className={`animate-in fade-in-0 fixed inset-0 z-50 flex duration-200 motion-reduce:animate-none ${
        full ? "" : "items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      }`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
        tabIndex={-1}
        className={`relative flex outline-none ${
          full
            ? `h-full w-full flex-col ${cinema ? "bg-black" : "bg-background"}`
            : `animate-in zoom-in-97 ease-out-soft gap-3 transition-[width,height,max-width,max-height] duration-300 motion-reduce:animate-none ${
                pdfFocusMode
                  ? "h-[94vh] w-[96vw]"
                  : "max-h-[90vh] max-w-[95vw]"
              }`
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* <header>, so an installed app's title bar rules (globals.css) keep
            these buttons clear of the window controls. */}
        {compact && !cinema && (
          <header className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent"
              aria-label="Close"
            >
              <XIcon size={20} />
            </button>
            <h3 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
              <HoverName as="span" name={file.name} className="truncate" />
            </h3>
            {pager}
            {cinemaFile && (
              <button
                onClick={() => setCinemaOn(true)}
                className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent"
                aria-label="Cinema mode"
                title="Cinema mode (T)"
              >
                <FrameCornersIcon size={20} />
              </button>
            )}
            <button
              onClick={() => setShowInfo(true)}
              className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent"
              aria-label="File info"
            >
              <InfoIcon size={20} />
            </button>
            <a
              href={dlHref}
              className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent"
              aria-label="Download"
            >
              <DownloadIcon size={20} />
            </a>
          </header>
        )}

        <div
          className={`group/media relative flex min-w-0 overflow-hidden ${
            full ? "" : "rounded-xl border"
          } ${
            pdfFocusMode
              ? "flex-1 bg-background"
              : `items-center justify-center ${full ? "min-h-0 flex-1" : ""} ${
                  cinema || videoFile ? "bg-black" : "bg-muted"
                }`
          }`}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <FileViewer
            file={file}
            src={viewSrc}
            layout={viewerLayout}
            officeProvider={officeProvider}
            onPdfFocusModeChange={compact ? undefined : handlePdfFocusModeChange}
            subtitleTracks={subtitleTracks}
            subtitleIndex={subtitleIndex}
            audioIndex={audioIndex}
            poster={posterUrl}
            storyboardSrc={storyboardUrl}
            startTime={startTime}
            onProgress={saveProgress}
          />
          {/* The way out of cinema mode sits on the picture, the details card
              being gone. Over a video it comes and goes with the player's
              own controls; over an image it's faint until pointed at. It
              clears a phone's notch and an installed app's window controls,
              which share this corner. */}
          {cinema && (
            <div
              className={`absolute top-[calc(max(env(safe-area-inset-top),env(titlebar-area-height,0px))+0.5rem)] right-[calc(env(safe-area-inset-right)+0.5rem)] z-10 flex gap-2 transition-opacity group-has-[.media-controls:not([data-visible])]/media:opacity-0 focus-within:opacity-100 hover:opacity-100 ${
                videoFile ? "" : "opacity-40"
              }`}
            >
              <button
                onClick={() => setCinemaOn(false)}
                className={GLASS_BUTTON}
                aria-label="Exit cinema mode"
                title="Exit cinema mode (T or Esc)"
              >
                <CornersInIcon size={18} />
              </button>
              <button onClick={onClose} className={GLASS_BUTTON} aria-label="Close">
                <XIcon size={18} />
              </button>
            </div>
          )}
        </div>

        {!full && !pdfFocusMode && (
          <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border bg-card">
            {/* Top to bottom: what the file is, what there is to know about
                it (the only part that scrolls), then what you do with it,
                pinned to the bottom edge with the download last. */}
            <div className="flex shrink-0 items-start gap-3 p-5">
              <div className="min-w-0 flex-1">
                {/* Two lines, not one: most of a long release-style name
                    survives, and the hover still shows all of it. */}
                <h3 className="text-lg leading-snug font-semibold">
                  <HoverName
                    as="span"
                    name={file.name}
                    className="line-clamp-2 wrap-anywhere"
                  />
                </h3>
                {meta}
              </div>
              <Button variant="outline" size="icon-sm" onClick={onClose} aria-label="Close">
                <XIcon />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-5 pb-4">{details}</div>
            </ScrollArea>
            <div className="shrink-0 px-5 pb-5">
              <div className="flex flex-col gap-2 border-t pt-4">
                {cinemaFile && (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setCinemaOn(true)}
                    aria-label="Cinema mode"
                    aria-keyshortcuts="T"
                    title="Cinema mode (T)"
                  >
                    <FrameCornersIcon /> Cinema mode
                    <kbd className="ml-1 rounded border px-1 font-mono text-[10px] text-muted-foreground">
                      T
                    </kbd>
                  </Button>
                )}
                {/* Stretched to the card's width, so the arrows line up with
                    the edges of the buttons above and below. */}
                {pager && <div className="*:w-full *:justify-between">{pager}</div>}
                {download}
              </div>
            </div>
          </aside>
        )}

        {compact && showInfo && (
          <>
            <div
              className="animate-in fade-in-0 fixed inset-0 z-60 bg-black/40 duration-200 motion-reduce:animate-none"
              onClick={() => setShowInfo(false)}
            />
            <ScrollArea
              role="dialog"
              aria-label="File details"
              className="fixed inset-x-0 bottom-0 z-70 mx-auto max-h-[75dvh] max-w-xl animate-in rounded-t-2xl border-t bg-card duration-200 slide-in-from-bottom motion-reduce:animate-none sm:border-x"
            >
              <div className="px-5 pt-3 pb-8">
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" />
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold wrap-anywhere">{file.name}</h3>
                    {meta}
                  </div>
                  <button
                    onClick={() => setShowInfo(false)}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                    aria-label="Close details"
                  >
                    <XIcon size={18} />
                  </button>
                </div>
                <div className="mb-5">{download}</div>
                {details}
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  )
}

// Every section shares one label column, so values line up down the whole
// panel instead of each block picking its own width.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t pt-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      <dl className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3 gap-y-2 text-sm">
        {children}
      </dl>
    </section>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{value}</dd>
    </>
  )
}

// One line each, however long: a click selects the whole value for copying,
// and the tooltip shows what the ellipsis hides.
function Mono({ children }: { children: string }) {
  return (
    <span
      title={children}
      className="block truncate font-mono text-xs text-muted-foreground select-all"
    >
      {children}
    </span>
  )
}

function isCsvFile(m: string, name: string) {
  return m === "text/csv" || /\.(csv|tsv)$/i.test(name)
}

function isTextFile(m: string, name: string) {
  if (m.startsWith("text/")) return true
  const textMimes = [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-sh",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
    "application/x-sql",
    "application/x-httpd-php",
  ]
  if (textMimes.includes(m)) return true
  return /\.(md|txt|log|json|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|less|html|htm|xml|svg|yml|yaml|toml|ini|conf|sh|bash|zsh|sql|env)$/i.test(
    name
  )
}

function isOfficeFile(m: string, name: string) {
  return (
    /\.(pptx?|docx?|xlsx?)$/i.test(name) ||
    m.includes("officedocument") ||
    m.includes("ms-powerpoint") ||
    m === "application/msword" ||
    m === "application/vnd.ms-excel"
  )
}

function isPdfFile(m: string, name: string) {
  return m === "application/pdf" || /\.pdf$/i.test(name)
}

// "modal" layout caps media to the viewport minus the 20rem details card, the
// 0.75rem gap beside it and the media card's own border. "fill" layout lets
// the viewer take 100% of its parent (used by callers that already give it a
// definite height, e.g. share pages).
const MODAL_MEDIA = {
  w: "max-w-[calc(95vw-20.75rem-2px)]",
  h: "max-h-[calc(90vh-2px)]",
  doc: "w-[calc(95vw-20.75rem-2px)] h-[calc(90vh-2px)] overflow-hidden",
}
const FILL_MEDIA = {
  w: "max-w-full",
  h: "max-h-full",
  doc: "h-full w-full overflow-hidden",
}

export type FileViewerLayout = "modal" | "fill"

// Exported so other surfaces (e.g. public share pages) can render a file
// inline using a caller-supplied URL without pulling in the full sidebar UI.
export function FileViewer({
  file,
  src,
  layout = "modal",
  officeProvider = "office",
  onPdfFocusModeChange,
  subtitleTracks = [],
  subtitleIndex = null,
  audioIndex = null,
  poster,
  storyboardSrc,
  startTime,
  onProgress,
}: {
  file: FileItem
  src: string
  layout?: FileViewerLayout
  officeProvider?: OfficeProvider
  onPdfFocusModeChange?: (focused: boolean) => void
  // Video track selection, owned by the caller's Properties panel. Omitted on
  // public surfaces (e.g. share pages), which get a plain player.
  subtitleTracks?: SubtitleTrack[]
  subtitleIndex?: number | null
  // Audio stream to request — folded into the video src as `?audio=`.
  audioIndex?: number | null
  // Poster image, scrubbing-preview storyboard, and resume position all need
  // an authenticated request, so like the track selection above these are
  // supplied by the caller and omitted on public surfaces.
  poster?: string
  storyboardSrc?: string
  startTime?: number
  onProgress?: (sec: number) => void
}) {
  const mime = file.mimeType
  const sizing = layout === "fill" ? FILL_MEDIA : MODAL_MEDIA

  if (mime.startsWith("image/")) {
    return (
      // Keyed: the next image starts fitted, not at the last one's zoom.
      <ZoomableImage
        key={src}
        src={src}
        alt={file.name}
        fill={layout === "fill"}
        className={`block ${sizing.h} ${sizing.w} object-contain`}
      />
    )
  }
  if (mime.startsWith("video/")) {
    const playSrc = audioIndex == null ? src : `${src}&audio=${audioIndex}`
    return (
      <VideoPreview
        key={playSrc}
        src={playSrc}
        tracks={subtitleTracks}
        subtitleIndex={subtitleIndex}
        poster={poster}
        storyboardSrc={storyboardSrc}
        startTime={startTime}
        onProgress={onProgress}
        className={`block bg-black ${sizing.h} ${sizing.w} ${
          layout === "fill" ? "h-full w-full" : "w-[90vw] aspect-video"
        }`}
      />
    )
  }
  if (mime.startsWith("audio/")) {
    return (
      <AudioPlayer src={src} name={file.name} />
    )
  }
  if (isPdfFile(mime, file.name)) {
    return (
      <div className={sizing.doc}>
        <Suspense
          fallback={
            <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
              Loading PDF viewer…
            </div>
          }
        >
          <LazyPdfViewer
            fileId={file.id}
            name={file.name}
            src={src}
            layout={layout}
            onFocusModeChange={onPdfFocusModeChange}
          />
        </Suspense>
      </div>
    )
  }
  if (isCsvFile(mime, file.name)) {
    return (
      <ScrollArea className={sizing.doc} horizontal>
        <CsvPreview
          src={src}
          delimiter={/\.tsv$/i.test(file.name) ? "\t" : ","}
        />
      </ScrollArea>
    )
  }
  if (isTextFile(mime, file.name)) {
    return (
      <ScrollArea className={sizing.doc} horizontal>
        <TextPreview src={src} />
      </ScrollArea>
    )
  }
  if (isOfficeFile(mime, file.name)) {
    return (
      <div className={sizing.doc}>
        <OfficePreview src={src} name={file.name} provider={officeProvider} />
      </div>
    )
  }
  return (
    <div className="grid w-md max-w-[80vw] place-items-center p-10 text-center text-muted-foreground">
      <div>
        <div className="mb-2 text-lg">Preview not available</div>
        <div className="text-sm">Download the file to view it.</div>
      </div>
    </div>
  )
}

// Wraps the player, adding fullscreen orientation locking on mobile. Subtitle
// tracks and the active selection are supplied by the caller (the Properties
// panel owns them).
function VideoPreview({
  src,
  tracks,
  subtitleIndex,
  poster,
  storyboardSrc,
  startTime,
  onProgress,
  className,
}: {
  src: string
  tracks: SubtitleTrack[]
  subtitleIndex: number | null
  poster?: string
  storyboardSrc?: string
  startTime?: number
  onProgress?: (sec: number) => void
  className?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = () => {
      const el = wrapperRef.current
      if (!el) return
      if (
        document.fullscreenElement &&
        el.contains(document.fullscreenElement)
      ) {
        const orientation = screen.orientation as ScreenOrientation & {
          lock?: (o: string) => Promise<void>
          unlock?: () => void
        }
        orientation?.lock?.("landscape").catch(() => {})
      } else if (!document.fullscreenElement) {
        try {
          const orientation = screen.orientation as ScreenOrientation & {
            unlock?: () => void
          }
          orientation?.unlock?.()
        } catch {
          // unlock() throws on browsers that never granted the lock; safe to ignore
        }
      }
    }
    document.addEventListener("fullscreenchange", handler)
    return () => {
      document.removeEventListener("fullscreenchange", handler)
      try {
        screen.orientation?.unlock?.()
      } catch {
        // unlock() throws on browsers that never granted the lock; safe to ignore
      }
    }
  }, [])

  return (
    <div ref={wrapperRef} className={className}>
      <DarkPlayer
        src={src}
        tracks={tracks}
        subtitleIndex={subtitleIndex}
        poster={poster}
        storyboardSrc={storyboardSrc}
        startTime={startTime}
        onProgress={onProgress}
        // The player's own wrappers size to the video's aspect ratio. Made to
        // fill the box instead, the video letterboxes itself inside it —
        // centred in a tall window, and never taller than a short one.
        className="h-full w-full [&_.media-default-skin]:h-full [&>div]:h-full"
      />
    </div>
  )
}

function TextPreview({ src }: { src: string }) {
  const [state, setState] = useState<{
    src: string
    text: string | null
    err: string | null
  }>({ src, text: null, err: null })

  useEffect(() => {
    let cancelled = false
    fetch(src, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`http_${r.status}`)
        const t = await r.text()
        if (!cancelled) setState({ src, text: t, err: null })
      })
      .catch((e) => {
        if (!cancelled) setState({ src, text: null, err: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [src])

  if (state.src !== src)
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  if (state.err)
    return (
      <div className="p-8 text-sm text-destructive">
        Failed to load: {state.err}
      </div>
    )
  if (state.text === null)
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  return (
    <pre className="p-4 font-mono text-xs whitespace-pre">{state.text}</pre>
  )
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === delimiter) {
        cur.push(field)
        field = ""
      } else if (c === "\n") {
        cur.push(field)
        rows.push(cur)
        cur = []
        field = ""
      } else if (c === "\r") {
        // skip
      } else {
        field += c
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }
  return rows
}

function CsvPreview({ src, delimiter }: { src: string; delimiter: string }) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const requestKey = `${src}::${delimiter}`

  useEffect(() => {
    let cancelled = false
    fetch(src, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`http_${r.status}`)
        const t = await r.text()
        if (!cancelled) {
          setRows(parseCsv(t, delimiter))
          setErr(null)
          setLoadedKey(requestKey)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setRows(null)
          setErr(e.message)
          setLoadedKey(requestKey)
        }
      })
    return () => {
      cancelled = true
    }
  }, [src, delimiter, requestKey])

  if (loadedKey !== requestKey)
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>

  if (err)
    return (
      <div className="p-8 text-sm text-destructive">Failed to load: {err}</div>
    )
  if (!rows)
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  if (rows.length === 0)
    return <div className="p-8 text-sm text-muted-foreground">Empty</div>

  const [head, ...body] = rows
  return (
    <div className="p-2">
      <Table>
        <TableHeader className="bg-accent sticky top-0">
          <TableRow>
            {head.map((h, i) => (
              <TableHead key={i}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((r, ri) => (
            <TableRow key={ri} className={ri % 2 ? "bg-muted/30" : ""}>
              {r.map((c, ci) => (
                <TableCell key={ci} className="whitespace-pre-wrap">
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type OfficeProvider = "office" | "google"

function buildOfficeViewerUrl(provider: OfficeProvider, sourceUrl: string) {
  if (provider === "google") {
    return `https://drive.google.com/viewer?embedded=true&url=${encodeURIComponent(sourceUrl)}`
  }
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(sourceUrl)}`
}

function OfficeProviderSwitch({
  provider,
  onChange,
}: {
  provider: OfficeProvider
  onChange: (provider: OfficeProvider) => void
}) {
  return (
    <div className="inline-flex rounded-lg border bg-background p-1">
      <button
        type="button"
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
          provider === "office"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("office")}
        aria-pressed={provider === "office"}
      >
        Office
      </button>
      <button
        type="button"
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
          provider === "google"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("google")}
        aria-pressed={provider === "google"}
      >
        Google
      </button>
    </div>
  )
}

function OfficePreview({
  src,
  name,
  provider,
}: {
  src: string
  name: string
  provider: OfficeProvider
}) {
  const [resolved, setResolved] = useState<{
    src: string
    sourceUrl: string
    expiresAt: string | null
  } | null>(null)
  const [err, setErr] = useState<{ src: string; message: string } | null>(null)

  const full = new URL(
    src,
    typeof window !== "undefined" ? window.location.origin : "http://localhost"
  )
  const usesServerPreview = /^\/api\/files\/[^/]+\/preview$/.test(full.pathname)
  const directSourceUrl = usesServerPreview ? null : full.toString()

  useEffect(() => {
    let cancelled = false

    if (!usesServerPreview) {
      return () => {
        cancelled = true
      }
    }

    const requestUrl = new URL(src, window.location.origin)
    requestUrl.searchParams.set("format", "json")
    fetch(requestUrl.toString(), { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`http_${r.status}`)
        const data = (await r.json()) as {
          sourceUrl?: string
          expiresAt?: string
        }

        if (!data.sourceUrl) throw new Error("missing_source_url")
        if (!cancelled) {
          setResolved({
            src,
            sourceUrl: data.sourceUrl,
            expiresAt: data.expiresAt ?? null,
          })
          setErr(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr({ src, message: e.message })
        }
      })

    return () => {
      cancelled = true
    }
  }, [src, usesServerPreview])

  const sourceUrl = usesServerPreview
    ? resolved?.src === src
      ? resolved.sourceUrl
      : null
    : directSourceUrl
  const expiresAt =
    usesServerPreview && resolved?.src === src ? resolved.expiresAt : null
  const activeErr = err?.src === src ? err.message : null

  if (activeErr) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-muted-foreground">
        <div>
          <div className="mb-2 text-lg text-foreground">
            Failed to load Office preview
          </div>
          <div className="text-sm text-destructive">{activeErr}</div>
        </div>
      </div>
    )
  }

  if (!sourceUrl) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }

  const viewer = buildOfficeViewerUrl(provider, sourceUrl)
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(
    sourceUrl
  )

  const meta = (
    <div className="mb-4 w-full max-w-2xl rounded border bg-muted p-4 text-left">
      <div className="mb-3 text-xs font-medium tracking-wider uppercase">
        Preview URLs
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="mb-1 text-xs font-medium text-muted-foreground">
            Viewer URL
          </dt>
          <dd className="rounded bg-background px-3 py-2 font-mono text-xs break-all text-foreground">
            {viewer}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-muted-foreground">
            Source URL
          </dt>
          <dd className="rounded bg-background px-3 py-2 font-mono text-xs break-all text-foreground">
            {sourceUrl}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-muted-foreground">
            Original Source
          </dt>
          <dd className="rounded bg-background px-3 py-2 font-mono text-xs break-all text-foreground">
            {src}
          </dd>
        </div>
        {expiresAt && (
          <div>
            <dt className="mb-1 text-xs font-medium text-muted-foreground">
              Source Expires
            </dt>
            <dd className="rounded bg-background px-3 py-2 text-xs text-foreground">
              {expiresAt}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )

  if (isLocal) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-muted-foreground">
        {meta}
        <div>
          <div className="mb-2 text-lg">Office preview needs a public URL</div>
          <div className="text-sm">
            Google and Office viewers can't reach files served from localhost.
            <br />
            Download to view, or try again on the deployed site.
          </div>
        </div>
      </div>
    )
  }
  return (
    <>
      <iframe
        src={viewer}
        className="h-full w-full border-0"
        title={name}
        allowFullScreen
      />
    </>
  )
}
