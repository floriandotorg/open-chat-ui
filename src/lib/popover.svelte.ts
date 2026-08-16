// Popovers must be portaled to <body>: a `.liquid-glass` dropdown nested
// inside the chat header's `.liquid-glass-bar-top` loses its backdrop-filter
// (nested backdrop-filter collapses on Safari), rendering it nearly
// transparent. Portaling plus fixed positioning escapes that stacking context.
export const portal = (node: HTMLElement) => {
  document.body.append(node)
  return { destroy: () => node.remove() }
}

export const createPopover = (align: 'left' | 'right' = 'left') => {
  let open = $state(false)
  let style = $state('')
  let trigger: HTMLButtonElement | undefined = $state()
  let content: HTMLElement | undefined = $state()

  const toggle = () => {
    if (!open && trigger) {
      const rect = trigger.getBoundingClientRect()
      style = align === 'left' ? `top: ${rect.bottom + 4}px; left: ${rect.left}px;` : `top: ${rect.bottom + 4}px; right: ${window.innerWidth - rect.right}px;`
    }
    open = !open
  }

  const close = () => {
    open = false
  }

  const handleScroll = (e: Event) => {
    if (e.target instanceof Node && content?.contains(e.target)) return
    close()
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  return {
    get open() {
      return open
    },
    get style() {
      return style
    },
    get trigger() {
      return trigger
    },
    set trigger(el: HTMLButtonElement | undefined) {
      trigger = el
    },
    get content() {
      return content
    },
    set content(el: HTMLElement | undefined) {
      content = el
    },
    toggle,
    close,
    handleScroll,
    handleKeydown,
  }
}
