import hljs from 'highlight.js'
import DOMPurify from 'isomorphic-dompurify'
import { Marked, type Tokens } from 'marked'

const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const marked = new Marked()

const renderer = {
  code({ text, lang }: Tokens.Code) {
    const language = lang ?? ''
    const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value

    const lines = highlighted.split('\n')
    const lineNumbersHtml = lines.map((_, n) => `<span class="code-line-number">${n + 1}</span>`).join('')
    const codeHtml = lines.map(line => `<span class="code-line">${line || ' '}</span>`).join('')

    return `<div class="code-block">
      <div class="code-header">
        <span class="code-lang">${language}</span>
        <button class="code-copy" data-code="${escapeHtml(text)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <div class="code-content">
        <div class="code-line-numbers">${lineNumbersHtml}</div>
        <pre><code class="hljs language-${language}">${codeHtml}</code></pre>
      </div>
    </div>`
  },
}

marked.use({ renderer })
marked.setOptions({ gfm: true, breaks: true })

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'data-code') {
    data.forceKeepAttr = true
  }
})

export const renderMarkdown = (text: string): string => {
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['button'],
    ADD_ATTR: ['data-code'],
  })
}
