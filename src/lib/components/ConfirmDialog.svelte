<script lang="ts">
let {
  open = $bindable(false),
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onconfirm,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onconfirm: () => void
} = $props()

let dialog: HTMLDialogElement | undefined = $state()

$effect(() => {
  if (!dialog) return
  if (open && !dialog.open) {
    dialog.showModal()
  } else if (!open && dialog.open) {
    dialog.close()
  }
})

const handleClose = () => {
  open = false
}

const handleConfirm = () => {
  open = false
  onconfirm()
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    open = false
  }
}

const handleBackdropClick = (e: MouseEvent) => {
  if (e.target === dialog) {
    open = false
  }
}
</script>

<dialog
  bind:this={dialog}
  onclose={handleClose}
  onkeydown={handleKeydown}
  onclick={handleBackdropClick}
  class="liquid-glass m-auto max-w-sm rounded-2xl p-6 backdrop:bg-black/40 backdrop:backdrop-blur-sm"
>
  <h3 class="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
  {#if description}
    <p class="mt-2 text-sm text-gray-500 dark:text-neutral-400">{description}</p>
  {/if}
  <div class="mt-5 flex justify-end gap-2">
    <button
      onclick={handleClose}
      class="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
    >{cancelLabel}</button>
    <button
      onclick={handleConfirm}
      class="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors {destructive
        ? 'bg-red-500 hover:bg-red-600'
        : 'bg-blue-500 hover:bg-blue-600'}"
    >{confirmLabel}</button>
  </div>
</dialog>
