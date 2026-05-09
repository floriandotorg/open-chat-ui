import hljs from 'highlight.js'
import katex from 'katex'
import { Marked, type Token, type Tokens } from 'marked'

const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const DANGEROUS_PROTOCOL = /^\s*(javascript|vbscript|data):/i

const marked = new Marked()

const renderer = {
  code({ text, lang }: Tokens.Code) {
    const language = lang ?? ''
    const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value

    const lines = highlighted.split('\n')
    const lineNumbersHtml = lines.map((_, n) => `<span class="code-line-number">${n + 1}</span>`).join('')
    const codeHtml = lines.map(line => `<span class="code-line">${line || ' '}</span>`).join('')

    return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="code-copy" data-code="${escapeHtml(text)}"><span>Copy</span></button></div><div class="code-content"><div class="code-line-numbers">${lineNumbersHtml}</div><pre><code class="hljs language-${language}">${codeHtml}</code></pre></div></div>`
  },
  html({ text }: Tokens.HTML | Tokens.Tag) {
    return escapeHtml(text)
  },
}

const sanitizeTokenUrls = (token: Token) => {
  if (token.type === 'link' && DANGEROUS_PROTOCOL.test(token.href)) {
    token.href = ''
  }
  if (token.type === 'image' && DANGEROUS_PROTOCOL.test(token.href)) {
    token.href = ''
  }
}

marked.use({ renderer, walkTokens: sanitizeTokenUrls })
marked.setOptions({ gfm: true, breaks: true })

const PH_OPEN = 'KATEX_PH'
const PH_CLOSE = 'KATEX_END'
const PH_RE = /KATEX_PH(\d+)KATEX_END/g

const renderKatex = (latex: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, strict: false })
  } catch {
    return escapeHtml(latex)
  }
}

const findCodeRegions = (text: string): Array<[number, number]> => {
  const regions: Array<[number, number]> = []
  let n = 0
  while (n < text.length) {
    const atLineStart = n === 0 || text[n - 1] === '\n'
    if (atLineStart) {
      const fence = /^([ \t]{0,3})(`{3,}|~{3,})/.exec(text.slice(n))
      if (fence) {
        const indent = fence[1].length
        const marker = fence[2]
        const afterFence = n + fence[0].length
        const restNewline = text.indexOf('\n', afterFence)
        const bodyStart = restNewline === -1 ? text.length : restNewline + 1
        const closeRe = new RegExp(`(?:^|\\n)[ \\t]{0,${indent + 3}}${marker[0]}{${marker.length},}[ \\t]*(?=\\n|$)`)
        const tail = text.slice(bodyStart)
        const close = closeRe.exec(tail)
        const end = close ? bodyStart + close.index + close[0].length : text.length
        regions.push([n, end])
        n = end
        continue
      }
    }
    if (text[n] === '`') {
      const runStart = n
      while (text[n] === '`') ++n
      const runLen = n - runStart
      const closeRe = new RegExp(`\`{${runLen}}(?!\`)`)
      const close = closeRe.exec(text.slice(n))
      if (close) {
        const end = n + close.index + runLen
        regions.push([runStart, end])
        n = end
        continue
      }
      n = runStart + 1
      continue
    }
    ++n
  }
  return regions
}

const extractMathInSegment = (text: string, mathBlocks: string[]): string => {
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    const index = mathBlocks.length
    mathBlocks.push(renderKatex(math.trim(), true))
    return `${PH_OPEN}${index}${PH_CLOSE}`
  })
  result = result.replace(/(?<![\\$\w])\$(?!\s)(?!\d)([^\n$]+?)(?<!\s)\$(?!\d)(?![$\w])/g, (_, math) => {
    const index = mathBlocks.length
    mathBlocks.push(renderKatex(math, false))
    return `${PH_OPEN}${index}${PH_CLOSE}`
  })
  return result
}

const extractMath = (text: string): { text: string; mathBlocks: string[] } => {
  const mathBlocks: string[] = []
  const regions = findCodeRegions(text)
  if (regions.length === 0) {
    return { text: extractMathInSegment(text, mathBlocks), mathBlocks }
  }
  let out = ''
  let cursor = 0
  for (const [start, end] of regions) {
    out += extractMathInSegment(text.slice(cursor, start), mathBlocks)
    out += text.slice(start, end)
    cursor = end
  }
  out += extractMathInSegment(text.slice(cursor), mathBlocks)
  return { text: out, mathBlocks }
}

const restoreMath = (html: string, mathBlocks: string[]): string => html.replace(PH_RE, (_, index) => mathBlocks[Number(index)])

export const renderMarkdown = (text: string): string => {
  const { text: textWithoutMath, mathBlocks } = extractMath(text)
  const html = marked.parse(textWithoutMath) as string
  return restoreMath(html, mathBlocks)
}
