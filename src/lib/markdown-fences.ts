const FENCE_RE = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/
const MARKDOWN_INFO = /^(markdown|md|mdx)$/i

type Fence = {
  line: number
  marker: string
  run: number
  info: string
}

const scanFences = (lines: string[]): Fence[] => {
  const fences: Fence[] = []
  for (const [line, text] of lines.entries()) {
    const match = FENCE_RE.exec(text)
    if (match) {
      fences.push({ line, marker: match[2][0], run: match[2].length, info: match[3].trim() })
    }
  }
  return fences
}

const isBalanced = (fences: Fence[]): boolean => {
  let depth = 0
  for (const fence of fences) {
    if (fence.info === '' && depth > 0) {
      --depth
    } else {
      ++depth
    }
  }
  return depth === 0
}

const deepen = (line: string, run: number): string => line.replace(FENCE_RE, (_, indent: string, marker: string, info: string) => indent + marker[0].repeat(run) + info)

export const normalizeFences = (text: string): string => {
  const lines = text.split('\n')
  const fences = scanFences(lines)
  const pairs: Array<[number, number]> = []
  let n = 0
  while (n < fences.length) {
    const opener = fences[n]
    if (!MARKDOWN_INFO.test(opener.info)) {
      ++n
      continue
    }
    let closer = -1
    for (let candidate = fences.length - 1; candidate > n; --candidate) {
      const fence = fences[candidate]
      if (fence.marker === opener.marker && fence.info === '' && isBalanced(fences.slice(n + 1, candidate))) {
        closer = candidate
        break
      }
    }
    if (closer <= n + 1) {
      ++n
      continue
    }
    pairs.push([n, closer])
    n = closer + 1
  }
  if (pairs.length === 0) {
    return text
  }
  for (const [openIndex, closeIndex] of pairs) {
    const span = fences.slice(openIndex, closeIndex + 1)
    const run = Math.max(...span.filter(fence => fence.marker === fences[openIndex].marker).map(fence => fence.run)) + 1
    lines[fences[openIndex].line] = deepen(lines[fences[openIndex].line], run)
    lines[fences[closeIndex].line] = deepen(lines[fences[closeIndex].line], run)
  }
  return lines.join('\n')
}
