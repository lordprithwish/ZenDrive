import { useCallback, useEffect, useMemo, useState } from "react"
import { CopyIcon, HourglassMediumIcon, TrashIcon } from "@phosphor-icons/react"
import { toQR } from "toqr"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { PopConfirm } from "@workspace/ui/components/popconfirm"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { apiGet, apiJson } from "@/lib/api"
import { WEB_ORIGIN } from "@/lib/config"
import { formatDate, relativeTime } from "@/lib/format"
import { parseUA } from "@/pages/admin/UserDetail"
import { toast } from "@/store/toast"

type TempSession = {
  id: string
  name: string
  expiresAt: string
  claimedAt: string | null
  lastSeenAt: string | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

// Minutes, keyed as strings for <Select>.
const DURATIONS: Record<string, string> = {
  "15": "15 minutes",
  "60": "1 hour",
  "240": "4 hours",
  "1440": "1 day",
  "10080": "7 days",
}

// Sign in on a device you don't trust: a one-time login link (or its QR, or
// the code typed at /t) that logs that browser in until the chosen time,
// then stops working.
// Server side: apps/api/src/routes/tempSessions.ts.
export function TempSessionsCard() {
  const [rows, setRows] = useState<TempSession[]>([])
  const [name, setName] = useState("")
  const [minutes, setMinutes] = useState("60")
  const [created, setCreated] = useState<{ id: string; code: string; expiresAt: string } | null>(
    null
  )
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    void apiGet<TempSession[]>("/api/temp-sessions").then(setRows).catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function create() {
    setBusy(true)
    try {
      setCreated(
        await apiJson<{ id: string; code: string; expiresAt: string }>(
          "/api/temp-sessions",
          "POST",
          { name: name.trim(), minutes: Number(minutes) }
        )
      )
      setName("")
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the session.")
    } finally {
      setBusy(false)
    }
  }

  async function end(id: string) {
    try {
      await apiJson(`/api/temp-sessions/${id}`, "DELETE")
      if (created?.id === id) setCreated(null)
      toast.success("Session ended.")
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't end it.")
    }
  }

  function copy(text: string) {
    void navigator.clipboard?.writeText(text)
    toast.success("Copied.")
  }

  const link = created ? `${WEB_ORIGIN}/t/${created.code}` : ""
  const now = Date.now()

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <HourglassMediumIcon size={16} weight="fill" />
            Temporary sessions
          </CardTitle>
          <span className="text-muted-foreground text-xs">{rows.length}</span>
        </div>
        <CardDescription>
          Sign in on a device you don't trust with a one-time login link, QR or code. It
          signs itself out when the time is up; end it here any time before that.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {rows.length > 0 && (
          <ul className="flex flex-col">
            {rows.map((s) => {
              const expired = new Date(s.expiresAt).getTime() <= now
              return (
                <li key={s.id} className="flex items-center gap-2 border-b py-1.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm">{s.name}</span>
                      <Badge variant={expired ? "muted" : s.claimedAt ? "default" : "outline"}>
                        {expired ? "expired" : s.claimedAt ? "active" : "waiting"}
                      </Badge>
                    </div>
                    <div
                      className="text-muted-foreground truncate text-xs"
                      title={s.userAgent ?? undefined}
                    >
                      {s.claimedAt
                        ? `${parseUA(s.userAgent)}${s.ip ? ` · ${s.ip}` : ""} · seen ${relativeTime(s.lastSeenAt ?? s.claimedAt)}`
                        : "Code not used yet"}
                      {` · ${expired ? "ended" : "ends"} ${formatDate(s.expiresAt)}`}
                    </div>
                  </div>
                  <PopConfirm
                    title={expired ? "Remove this entry?" : "End this session?"}
                    description={
                      expired
                        ? "It has already ended; this just clears it from the list."
                        : "That device is signed out on its next request."
                    }
                    confirmLabel={expired ? "Remove" : "End"}
                    onConfirm={() => end(s.id)}
                    trigger={
                      <Button size="icon-sm" variant="ghost" title={expired ? "Remove" : "End"}>
                        <TrashIcon size={14} />
                      </Button>
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Label, e.g. Library PC"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            maxLength={60}
            className="h-8 min-w-0 flex-1 basis-40 text-xs"
          />
          <Select items={DURATIONS} value={minutes} onValueChange={(v) => setMinutes(v as string)}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DURATIONS).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={create} disabled={busy}>
            Create
          </Button>
        </div>

        {created && (
          <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row">
            <QrCode value={link} className="h-36 w-36 shrink-0 self-center rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs text-amber-500">
                Shown once. Works a single time, until {formatDate(created.expiresAt)}.
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl tracking-widest">{created.code}</span>
                <Button size="icon-sm" variant="ghost" title="Copy code" onClick={() => copy(created.code)}>
                  <CopyIcon size={14} />
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Scan the QR or open the login link on the other device to sign in straight
                away — or go to{" "}
                <span className="text-foreground font-mono">{new URL(WEB_ORIGIN).host}/t</span> there
                and type the code.
              </p>
              <div className="flex gap-2">
                <Input readOnly value={link} aria-label="Login link" className="h-8 text-[11px]" />
                <Button size="sm" variant="outline" title="Copy login link" onClick={() => copy(link)}>
                  <CopyIcon size={14} />
                </Button>
              </div>
              <p className="text-muted-foreground text-[11px]">
                Whoever opens the link first is signed in, so only send it to yourself.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// toqr returns a flat n×n grid of 0/1 modules; each dark one is a 1×1 square
// in a single path. The 4-module white border is the quiet zone scanners
// need, and stays white in dark mode so phones can still read it.
export function QrCode({
  value,
  className,
  label = "QR code of the sign-in link",
}: {
  value: string
  className?: string
  label?: string
}) {
  const { n, d } = useMemo(() => {
    const m = toQR(value)
    const n = Math.sqrt(m.length)
    let d = ""
    m.forEach((on, i) => {
      if (on) d += `M${i % n} ${Math.floor(i / n)}h1v1h-1z`
    })
    return { n, d }
  }, [value])
  return (
    <svg
      viewBox={`-4 -4 ${n + 8} ${n + 8}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className={className}
    >
      <rect x={-4} y={-4} width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}
