export interface HighlightSegment {
  text: string
  match: boolean
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const splitByTerms = (text: string, terms: string[]): HighlightSegment[] => {
  if (!text) return []
  const cleaned = terms.filter(t => t.length > 0)
  if (cleaned.length === 0) return [{ text, match: false }]
  const sorted = [...cleaned].sort((a, b) => b.length - a.length).map(escapeRegex)
  const pattern = new RegExp(`(${sorted.join('|')})`, 'gi')
  const parts = text.split(pattern)
  const segments: HighlightSegment[] = []
  for (let n = 0; n < parts.length; ++n) {
    if (parts[n].length === 0) continue
    segments.push({ text: parts[n], match: n % 2 === 1 })
  }
  return segments
}
