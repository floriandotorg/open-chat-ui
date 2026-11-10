import { type AxNode, createRefRegistry, findNodes, renderAxTree } from './accessibility'
import { describe, expect, it } from 'vitest'

const node = (nodeId: string, role: string, name: string, extra: Partial<AxNode> = {}): AxNode => ({
  nodeId,
  ignored: false,
  role: { value: role },
  name: { value: name },
  ...extra,
})

const tree = (): AxNode[] => [
  node('1', 'RootWebArea', 'Shop', { childIds: ['2', '3', '7'], backendDOMNodeId: 1 }),
  node('2', 'heading', 'Welcome', { parentId: '1', properties: [{ name: 'level', value: { value: 1 } }], backendDOMNodeId: 2 }),
  node('3', 'generic', '', { parentId: '1', childIds: ['4', '5', '6'], backendDOMNodeId: 3 }),
  node('4', 'textbox', 'Email', { parentId: '3', value: { value: 'a@b.c' }, properties: [{ name: 'required', value: { value: true } }], backendDOMNodeId: 4 }),
  node('5', 'checkbox', 'Remember me', { parentId: '3', properties: [{ name: 'checked', value: { value: 'true' } }], backendDOMNodeId: 5 }),
  node('6', 'button', 'Sign in', { parentId: '3', childIds: ['8'], backendDOMNodeId: 6 }),
  node('7', 'link', 'Forgot password?', { parentId: '1', backendDOMNodeId: 7 }),
  node('8', 'StaticText', 'Sign in', { parentId: '6', backendDOMNodeId: 8 }),
  { nodeId: '9', ignored: true, role: { value: 'button' }, name: { value: 'Hidden' }, parentId: '1', backendDOMNodeId: 9 },
]

describe('renderAxTree', () => {
  it('lists interactive nodes with refs and states', () => {
    const registry = createRefRegistry()
    const text = renderAxTree(tree(), { filter: 'interactive', refs: registry })
    expect(text).toBe(['- textbox "Email" value="a@b.c" required [ref_1]', '- checkbox "Remember me" checked [ref_2]', '- button "Sign in" [ref_3]', '- link "Forgot password?" [ref_4]'].join('\n'))
    expect(registry.resolve('ref_3')).toBe(6)
  })

  it('renders structure and hoists children of unnamed generic nodes', () => {
    const text = renderAxTree(tree(), { filter: 'all', refs: createRefRegistry() })
    expect(text.split('\n')).toEqual(['- RootWebArea "Shop" [ref_1]', '  - heading "Welcome" level=1 [ref_2]', '  - textbox "Email" value="a@b.c" required [ref_3]', '  - checkbox "Remember me" checked [ref_4]', '  - button "Sign in" [ref_5]', '  - link "Forgot password?" [ref_6]'])
  })

  it('keeps refs stable for the same node', () => {
    const registry = createRefRegistry()
    renderAxTree(tree(), { filter: 'interactive', refs: registry })
    const again = renderAxTree(tree(), { filter: 'interactive', refs: registry })
    expect(again).toContain('button "Sign in" [ref_3]')
  })

  it('limits depth', () => {
    const text = renderAxTree(tree(), { filter: 'all', depth: 1, refs: createRefRegistry() })
    expect(text).toBe('- RootWebArea "Shop" [ref_1]')
  })

  it('reads a subtree by ref', () => {
    const registry = createRefRegistry()
    renderAxTree(tree(), { filter: 'all', refs: registry })
    const text = renderAxTree(tree(), { filter: 'all', refs: registry, rootRef: 'ref_5' })
    expect(text).toBe('- button "Sign in" [ref_5]')
  })

  it('reports an unknown root ref', () => {
    expect(() => renderAxTree(tree(), { filter: 'all', refs: createRefRegistry(), rootRef: 'ref_99' })).toThrow(/ref_99/)
  })

  it('truncates long output', () => {
    const many: AxNode[] = [node('r', 'RootWebArea', 'Big', { childIds: Array.from({ length: 2000 }, (_, n) => `c${n}`) })]
    for (let n = 0; n < 2000; ++n) {
      many.push(node(`c${n}`, 'link', 'x'.repeat(40), { parentId: 'r', backendDOMNodeId: 100 + n }))
    }
    const text = renderAxTree(many, { filter: 'interactive', refs: createRefRegistry(), maxChars: 1000 })
    expect(text.length).toBeLessThan(1200)
    expect(text).toMatch(/Truncated/)
  })

  it('escapes quotes and newlines in names', () => {
    const text = renderAxTree([node('1', 'button', 'Say "hi"\nnow', { backendDOMNodeId: 1 })], { filter: 'interactive', refs: createRefRegistry() })
    expect(text).toBe('- button "Say \\"hi\\" now" [ref_1]')
  })
})

describe('findNodes', () => {
  it('matches tokens against role and name, interactive first', () => {
    const registry = createRefRegistry()
    const text = findNodes(tree(), 'sign in button', registry)
    expect(text.split('\n')[0]).toBe('- button "Sign in" [ref_1]')
  })

  it('reports no matches', () => {
    expect(findNodes(tree(), 'checkout', createRefRegistry())).toMatch(/No elements match/)
  })

  it('ignores ignored nodes', () => {
    expect(findNodes(tree(), 'hidden', createRefRegistry())).toMatch(/No elements match/)
  })
})

describe('createRefRegistry', () => {
  it('forgets refs on reset', () => {
    const registry = createRefRegistry()
    const ref = registry.refFor(42)
    expect(registry.resolve(ref)).toBe(42)
    registry.reset()
    expect(registry.resolve(ref)).toBeUndefined()
    expect(registry.refFor(7)).toBe('ref_1')
  })
})
