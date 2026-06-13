export const findMarkdownCodeRegions = (text: string): Array<[number, number]> => {
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
      while (text[n] === '`') {
        ++n
      }
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
