import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'isomorphic-dompurify'

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
      return hljs.highlightAuto(code).value
    },
  }),
)

marked.setOptions({
  gfm: true,
  breaks: true,
})

export const renderMarkdown = (text: string): string => {
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html)
}
