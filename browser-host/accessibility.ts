export interface AxValue {
  value?: unknown
}

export interface AxNode {
  nodeId: string
  ignored: boolean
  role?: AxValue
  name?: AxValue
  value?: AxValue
  properties?: { name: string; value: AxValue }[]
  parentId?: string
  childIds?: string[]
  backendDOMNodeId?: number
}

export const MAX_READ_CHARS = 50_000
const MAX_FIND_RESULTS = 20

const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem', 'textField', 'TextField', 'PopUpButton'])
const STRUCTURAL_ROLES = new Set(['RootWebArea', 'heading', 'main', 'navigation', 'form', 'dialog', 'alertdialog', 'list', 'table', 'row', 'cell', 'region', 'banner', 'contentinfo', 'search', 'img', 'alert'])
const SKIPPED_ROLES = new Set(['InlineTextBox', 'LineBreak', 'none', 'presentation'])
const STATE_FLAGS = ['required', 'disabled', 'focused', 'selected', 'expanded', 'readonly', 'invalid']

export const createRefRegistry = () => {
  let counter = 0
  const byRef = new Map<string, number>()
  const byBackendId = new Map<number, string>()

  const refFor = (backendId: number): string => {
    const existing = byBackendId.get(backendId)
    if (existing) {
      return existing
    }
    const ref = `ref_${++counter}`
    byRef.set(ref, backendId)
    byBackendId.set(backendId, ref)
    return ref
  }

  const resolve = (ref: string): number | undefined => byRef.get(ref)

  const reset = () => {
    counter = 0
    byRef.clear()
    byBackendId.clear()
  }

  return { refFor, resolve, reset }
}

export type RefRegistry = ReturnType<typeof createRefRegistry>

const text = (value: AxValue | undefined): string => {
  const raw = value?.value
  if (typeof raw === 'string') {
    return raw.replace(/\s+/g, ' ').trim()
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw)
  }
  return ''
}

const quote = (value: string): string => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

const property = (node: AxNode, name: string): unknown => node.properties?.find(entry => entry.name === name)?.value.value

const describeNode = (node: AxNode, refs: RefRegistry): string => {
  const role = text(node.role) || 'unknown'
  const parts = [`- ${role}`]
  const name = text(node.name)
  if (name) {
    parts.push(quote(name))
  }
  const value = text(node.value)
  if (value && value !== name) {
    parts.push(`value=${quote(value)}`)
  }
  const level = property(node, 'level')
  if (typeof level === 'number') {
    parts.push(`level=${level}`)
  }
  const checked = property(node, 'checked')
  if (checked === 'true' || checked === true) {
    parts.push('checked')
  } else if (checked === 'mixed') {
    parts.push('checked=mixed')
  }
  for (const flag of STATE_FLAGS) {
    const flagValue = property(node, flag)
    if (flagValue === true || flagValue === 'true') {
      parts.push(flag)
    }
  }
  if (node.backendDOMNodeId !== undefined) {
    parts.push(`[${refs.refFor(node.backendDOMNodeId)}]`)
  }
  return parts.join(' ')
}

const isInteractive = (node: AxNode): boolean => INTERACTIVE_ROLES.has(text(node.role))

const includeNode = (node: AxNode, filter: 'interactive' | 'all', parent: AxNode | undefined): boolean => {
  if (node.ignored) {
    return false
  }
  const role = text(node.role)
  if (SKIPPED_ROLES.has(role)) {
    return false
  }
  if (filter === 'interactive') {
    return isInteractive(node)
  }
  const name = text(node.name)
  if (role === 'StaticText') {
    return !!name && !(parent && text(parent.name).includes(name))
  }
  return !!name || !!text(node.value) || STRUCTURAL_ROLES.has(role) || isInteractive(node)
}

export interface RenderOptions {
  filter: 'interactive' | 'all'
  refs: RefRegistry
  depth?: number
  rootRef?: string
  maxChars?: number
}

export const renderAxTree = (nodes: AxNode[], { filter, refs, depth, rootRef, maxChars = MAX_READ_CHARS }: RenderOptions): string => {
  const byId = new Map(nodes.map(node => [node.nodeId, node]))
  let roots = nodes.filter(node => !node.parentId || !byId.has(node.parentId))
  if (rootRef) {
    const backendId = refs.resolve(rootRef)
    const root = backendId === undefined ? undefined : nodes.find(node => node.backendDOMNodeId === backendId)
    if (!root) {
      throw new Error(`Unknown or stale ref ${rootRef}. Call read_page again.`)
    }
    roots = [root]
  }
  const lines: string[] = []
  let length = 0
  let truncated = false

  const visit = (node: AxNode, level: number, parent: AxNode | undefined) => {
    if (truncated) {
      return
    }
    const included = includeNode(node, filter, parent) || (rootRef !== undefined && node === roots[0])
    const childLevel = included && filter === 'all' ? level + 1 : level
    if (included) {
      if (depth !== undefined && level >= depth) {
        return
      }
      const line = `${'  '.repeat(filter === 'all' ? level : 0)}${describeNode(node, refs)}`
      if (length + line.length + 1 > maxChars) {
        truncated = true
        return
      }
      lines.push(line)
      length += line.length + 1
    }
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child) {
        visit(child, childLevel, included ? node : parent)
      }
    }
  }

  for (const root of roots) {
    visit(root, 0, undefined)
  }
  if (truncated) {
    lines.push(`[Truncated at ${maxChars} characters. Use depth or ref to read less.]`)
  }
  return lines.length ? lines.join('\n') : 'No matching elements on this page.'
}

export const findNodes = (nodes: AxNode[], query: string, refs: RefRegistry): string => {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const byId = new Map(nodes.map(node => [node.nodeId, node]))
  const repeatsParent = (node: AxNode): boolean => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    return text(node.role) === 'StaticText' && !!parent && text(parent.name).includes(text(node.name))
  }
  const scored = nodes
    .filter(node => !node.ignored && !SKIPPED_ROLES.has(text(node.role)) && (text(node.name) || text(node.value)) && !repeatsParent(node))
    .map(node => {
      const haystack = `${text(node.role)} ${text(node.name)} ${text(node.value)}`.toLowerCase()
      return { node, score: tokens.filter(token => haystack.includes(token)).length }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(isInteractive(b.node)) - Number(isInteractive(a.node)))
    .slice(0, MAX_FIND_RESULTS)
  if (!scored.length) {
    return `No elements match "${query}". Try read_page.`
  }
  return scored.map(entry => describeNode(entry.node, refs)).join('\n')
}
