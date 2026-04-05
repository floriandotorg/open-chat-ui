const handleCopyClick = (event: MouseEvent) => {
  const button = (event.target as HTMLElement).closest('.code-copy') as HTMLButtonElement | null
  if (!button) return

  const code = button.dataset.code
  if (!code) return

  navigator.clipboard.writeText(code)

  const label = button.querySelector('span')
  if (label) {
    const original = label.textContent
    label.textContent = 'Copied!'
    setTimeout(() => {
      label.textContent = original
    }, 2000)
  }
}

export const copyCodeAction = (node: HTMLElement) => {
  node.addEventListener('click', handleCopyClick)
  return {
    destroy() {
      node.removeEventListener('click', handleCopyClick)
    },
  }
}
