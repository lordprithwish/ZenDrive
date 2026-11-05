import { useState } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

// Wraps a file/folder name so hovering it reveals the full name in a
// popover — pass the same className you'd put on a truncated name element.
export function HoverName({
  name,
  className,
  as = "span",
}: {
  name: string
  className?: string
  as?: "span" | "div"
}) {
  const Tag = as
  // Shut by a right-click: the context menu opens under the pointer, and
  // this would sit on its corner.
  const [open, setOpen] = useState(false)
  return (
    // Hover only. A click on the name is the row's (select, open, pick a
    // folder); opened by it, the popover would stay pinned after the row scrolls.
    <Popover open={open} onOpenChange={(o, d) => setOpen(o && d.reason !== "trigger-press")}>
      <PopoverTrigger
        nativeButton={false}
        openOnHover
        delay={300}
        render={<Tag className={className} onContextMenu={() => setOpen(false)} />}
      >
        {name}
      </PopoverTrigger>
      <PopoverContent
        positionerClassName="z-80"
        className="w-auto max-w-xs rounded-lg px-3 py-1.5 text-sm wrap-break-word"
      >
        {name}
      </PopoverContent>
    </Popover>
  )
}
