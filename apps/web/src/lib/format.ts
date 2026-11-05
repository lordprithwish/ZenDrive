export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// "just now", "3m ago", "4h ago", "2d ago", "3w ago", "Feb 14" — compact
// relative timestamps tuned for activity feeds.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return "—"
  const diff = Math.max(0, Date.now() - then)
  const sec = Math.floor(diff / 1000)
  // Under a minute, or "0m ago" would show from 45s on.
  if (sec < 60) return "just now"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 4) return `${wk}w ago`
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(then).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  })
}

// Mirrors the API's trash auto-purge window (TRASH_RETENTION_MS in
// apps/api/src/routes/me.ts) so the bin can warn before the sweep runs.
const TRASH_RETENTION_DAYS = 30

export function purgeCountdown(trashedAtIso: string): string {
  const trashedAt = new Date(trashedAtIso).getTime()
  if (!Number.isFinite(trashedAt)) return ""
  const daysLeft = Math.ceil(
    (trashedAt + TRASH_RETENTION_DAYS * 86400000 - Date.now()) / 86400000
  )
  if (daysLeft <= 0) return "Deletes soon"
  if (daysLeft === 1) return "Deletes in 1 day"
  return `Deletes in ${daysLeft} days`
}
