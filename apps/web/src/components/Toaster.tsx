import {
  CheckCircleIcon,
  WarningCircleIcon,
  InfoIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useToasts, type ToastKind } from "@/store/toast"

function iconFor(kind: ToastKind) {
  const size = 18
  if (kind === "success")
    return (
      <CheckCircleIcon
        size={size}
        weight="fill"
        className="text-success"
      />
    )
  if (kind === "error")
    return (
      <WarningCircleIcon
        size={size}
        weight="fill"
        className="text-destructive"
      />
    )
  return <InfoIcon size={size} weight="fill" className="text-sky-500" />
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col-reverse gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="bg-card animate-in slide-in-from-right-4 fade-in ease-out-soft pointer-events-auto flex items-start gap-2 rounded-xl border p-3 shadow-xl shadow-black/10 duration-300 motion-reduce:animate-none dark:shadow-black/40"
        >
          <div className="mt-0.5 shrink-0">{iconFor(t.kind)}</div>
          <div className="min-w-0 flex-1 text-sm">{t.message}</div>
          {t.action && (
            <button
              className="text-primary hover:bg-primary/10 shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold"
              onClick={async () => {
                try {
                  await t.action!.onClick()
                } finally {
                  dismiss(t.id)
                }
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            className="hover:bg-accent text-muted-foreground shrink-0 rounded-md p-1"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            <XIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
