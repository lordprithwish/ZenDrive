import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "@workspace/ui/lib/utils"

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root {...props} />
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  positionerClassName,
  align = "center",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props & {
  align?: PopoverPrimitive.Positioner.Props["align"]
  sideOffset?: number
  // Positioner is `position: fixed`, which always starts its own stacking
  // context — a z-index on Popup alone can't out-rank a sibling overlay
  // (e.g. a modal) since it never leaves that inner context. Override this
  // when the popover must appear above a specific high z-index dialog.
  positionerClassName?: string
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50", positionerClassName)}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "bg-popover text-popover-foreground w-72 rounded-xl border p-3 shadow-xl shadow-black/10 outline-none dark:shadow-black/40",
            // Grows out of whatever opened it (Base UI sets the origin to the
            // trigger's side), and shrinks back a little faster.
            "origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-out-soft data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-100",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverClose }
