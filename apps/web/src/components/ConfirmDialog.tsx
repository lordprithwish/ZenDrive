import { WarningIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Modal } from "@/components/Modal"
import { useConfirm } from "@/store/confirm"

export function ConfirmDialog() {
  const pending = useConfirm((s) => s.pending)
  const close = useConfirm((s) => s.close)

  return (
    <Modal
      open={!!pending}
      onClose={() => close(false)}
      size="sm"
      showCloseButton={false}
      icon={pending?.destructive && <WarningIcon size={18} weight="fill" className="text-destructive" />}
      title={pending?.title}
      description={pending?.description}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => close(false)}>
            {pending?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            size="sm"
            variant={pending?.destructive ? "destructive" : "default"}
            onClick={() => close(true)}
            autoFocus
          >
            {pending?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    />
  )
}
