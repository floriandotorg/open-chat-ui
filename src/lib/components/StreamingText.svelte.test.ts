import StreamingText from './StreamingText.svelte'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-svelte'

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

const proseTextNode = (container: HTMLElement): Text => {
  const node = container.querySelector('.prose p')?.firstChild
  if (!(node instanceof Text)) throw new Error('no prose text node')
  return node
}

const selectText = (node: Text, start: number, end: number): Selection => {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = window.getSelection()
  if (!selection) throw new Error('no selection')
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

test('keeps an active selection stable while streaming text updates', async () => {
  const initial = 'The quick brown fox jumps over'
  const { container, rerender } = render(StreamingText, { props: { text: initial } })
  await flush()

  const selection = selectText(proseTextNode(container), 4, 15)
  await flush()

  await rerender({ text: `${initial} the lazy dog` })
  await flush()

  expect(selection.toString()).toBe('quick brown')
})

test('resumes rendering updates after the selection is cleared', async () => {
  const initial = 'The quick brown fox jumps over'
  const { container, rerender } = render(StreamingText, { props: { text: initial } })
  await flush()

  const selection = selectText(proseTextNode(container), 4, 15)
  await flush()

  await rerender({ text: `${initial} the lazy dog` })
  await flush()
  expect(container.querySelector('.prose')?.textContent).not.toContain('lazy dog')

  selection.removeAllRanges()
  await flush()
  expect(container.querySelector('.prose')?.textContent).toContain('lazy dog')
})
