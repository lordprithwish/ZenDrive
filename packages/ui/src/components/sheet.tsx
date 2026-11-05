import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { DialogOverlay, DialogPortal } from "@workspace/ui/components/dialog"

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

// A Dialog docked to a screen edge instead of centered — same primitive as
// Dialog, just positioned and animated differently via `side`.
function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "bg-background fixed z-50 flex flex-col gap-0 shadow-xl outline-none duration-300 ease-out-soft data-open:animate-in data-closed:animate-out data-closed:duration-200 data-closed:ease-in",
          side === "right" &&
            "data-open:slide-in-from-right data-closed:slide-out-to-right inset-y-0 right-0 h-full w-full border-l sm:max-w-sm",
          side === "left" &&
            "data-open:slide-in-from-left data-closed:slide-out-to-left inset-y-0 left-0 h-full w-full border-r sm:max-w-sm",
          side === "top" &&
            "data-open:slide-in-from-top data-closed:slide-out-to-top inset-x-0 top-0 h-auto border-b",
          side === "bottom" &&
            "data-open:slide-in-from-bottom data-closed:slide-out-to-bottom inset-x-0 bottom-0 h-auto border-t",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent }
