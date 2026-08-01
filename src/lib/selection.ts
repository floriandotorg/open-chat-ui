export const selectionIntersects = (node: HTMLElement | undefined): boolean => {
  if (!node) return false
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return false
  for (let n = 0; n < selection.rangeCount; ++n) {
    if (selection.getRangeAt(n).intersectsNode(node)) return true
  }
  return false
}
