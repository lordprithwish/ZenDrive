import type { ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

// Width comes from `w-*`; the base DialogContent's max-w only keeps a gutter
// on phones. Don't size dialogs with max-w-* — that's what made them all 28rem.
const SIZES = {
  sm: "w-sm",
  md: "w-md",
  lg: "w-lg",
  xl: "w-xl",
  "2xl": "w-2xl",
  "3xl": "w-3xl",
  "6xl": "w-6xl",
}

type Props = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  size?: keyof typeof SIZES
  footer?: ReactNode
  children?: ReactNode
  /** On the dialog itself — e.g. a fixed height for browser-style pickers. */
  className?: string
  /** On the body — padding, or `flex` for multi-pane layouts. */
  bodyClassName?: string
  /** False for multi-pane layouts whose panes scroll themselves. */
  scrollBody?: boolean
  showCloseButton?: boolean
}

// The app's one dialog layout: bordered header, scrolling body, bordered
// footer. Header and footer stay pinned; only the body scrolls, once the
// dialog reaches the height DialogContent caps it at.
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  size = "md",
  footer,
  children,
  className,
  bodyClassName,
  scrollBody = true,
  showCloseButton,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={showCloseButton}
        className={cn("flex flex-col gap-0 overflow-hidden p-0", SIZES[size], className)}
      >
        {/* A breath of the brand colour behind the title: every dialog reads
            as DarkDrive's own without anything competing with the content. */}
        <DialogHeader
          className={cn(
            "from-primary/6 flex-row items-start gap-3 bg-linear-to-b to-transparent p-4 pr-12",
            children != null && "border-b"
          )}
        >
          {icon && (
            <div className="bg-muted ring-border/60 grid shrink-0 place-items-center rounded-xl p-2 ring-1">
              {icon}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <DialogTitle className="leading-snug">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
        </DialogHeader>
        {children != null && (
          scrollBody ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className={bodyClassName}>{children}</div>
            </ScrollArea>
          ) : (
            <div className={cn("min-h-0 flex-1 overflow-hidden", bodyClassName)}>{children}</div>
          )
        )}
        {footer && (
          <DialogFooter className="bg-muted/40 flex-row flex-wrap items-center justify-end border-t p-3">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
