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

const extractMath = (text: string): { text: string; mathBlocks: string[] } => {
  const mathBlocks: string[] = []
  let result = text

  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    const index = mathBlocks.length
    mathBlocks.push(renderKatex(math.trim(), true))
    return `${PH_OPEN}${index}${PH_CLOSE}`
  })

  result = result.replace(/(?<![\\$\w])\$(?!\s)(?!\d)([^\n$]+?)(?<!\s)\$(?!\d)(?![$\w])/g, (_, math) => {
    const index = mathBlocks.length
    mathBlocks.push(renderKatex(math, false))
    return `${PH_OPEN}${index}${PH_CLOSE}`
  })

  return { text: result, mathBlocks }
}

const restoreMath = (html: string, mathBlocks: string[]): string => html.replace(PH_RE, (_, index) => mathBlocks[Number(index)])

export const renderMarkdown = (text: string): string => {
  const { text: textWithoutMath, mathBlocks } = extractMath(text)
  const html = marked.parse(textWithoutMath) as string
  return restoreMath(html, mathBlocks)
}
