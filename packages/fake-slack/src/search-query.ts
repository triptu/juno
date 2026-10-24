/** Independent fake implementation of the observed Slack query grammar. */
export function parseQuery(text: string, timeZone: string) {
  const terms: Array<{ value: string; negative: boolean }> = []
  const from: string[] = [], excludeFrom: string[] = [], channels: string[] = [], excludeChannels: string[] = [], has: string[] = []
  let thread = false, earliest = -Infinity, latest = Infinity
  for (const token of text.match(/(?:[^\s"\\]|\\.|"(?:[^"\\]|\\.)*")+/g) ?? []) {
    const negative = token.startsWith('-')
    const body = negative ? token.slice(1) : token
    const match = /^(from|in|before|after|on|during|has|is):(.*)$/.exec(body)
    const value = (match?.[2] ?? body).replace(/^"(.*)"$/, '$1').replace(/\\(["\\])/g, '$1')
    const identity = value.replace(/^<[@#]([^|>]+)(?:\|[^>]*)?>$/, '$1').replace(/^[@#]/, '').toLowerCase()
    switch (match?.[1]) {
      case 'from': (negative ? excludeFrom : from).push(identity); break
      case 'in': (negative ? excludeChannels : channels).push(identity); break
      case 'has': has.push(value); break
      case 'is': thread = value === 'thread'; break
      case 'after': case 'before': case 'on': case 'during': {
        const pieces = value.split('-').map(Number)
        const year = pieces[0] ?? 0, month = pieces[1] ?? 1, day = pieces[2] ?? 1
        const start = localMidnight(year, month, day, timeZone)
        const end = localMidnight(year + (pieces.length === 1 ? 1 : 0), month + (pieces.length === 2 ? 1 : 0), day + (pieces.length === 3 ? 1 : 0), timeZone)
        if (match[1] === 'after') earliest = Math.max(earliest, end)
        else if (match[1] === 'before') latest = Math.min(latest, start)
        else { earliest = Math.max(earliest, start); latest = Math.min(latest, end) }
        break
      }
      default: terms.push({ value: value.toLowerCase(), negative })
    }
  }
  return { terms, from, excludeFrom, channels, excludeChannels, has, thread, earliest, latest }
}

function localMidnight(year: number, month: number, day: number, timeZone: string): number {
  const target = Date.UTC(year, month - 1, day)
  let at = target
  const formatter = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, Number(p.value)]))
    const shift = target - Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0)
    if (shift === 0) break
    at += shift
  }
  return at / 1000
}

export const termMatches = (text: string, value: string): boolean => {
  const words = (s: string) => (s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).join(' ')
  return ` ${words(text)} `.includes(` ${words(value)} `)
}
export function highlightExtract(text: string, terms: ReadonlyArray<{ value: string; negative: boolean }>, highlight: boolean, length = 200) {
  const ranges: Array<{ start: number; end: number }> = []
  for (const term of terms) if (!term.negative) {
    const start = text.toLowerCase().indexOf(term.value)
    if (start >= 0) ranges.push({ start, end: start + term.value.length })
  }
  ranges.sort((a, b) => a.start - b.start)
  const start = Math.max(0, (ranges[0]?.start ?? 0) - 40)
  const end = Math.min(text.length, Math.max(start + length, ranges[0]?.end ?? 0))
  let marked = '', cursor = start
  for (const range of highlight ? ranges : []) if (range.start >= cursor && range.end <= end) {
    marked += text.slice(cursor, range.start) + '\uE000' + text.slice(range.start, range.end) + '\uE001'
    cursor = range.end
  }
  marked += text.slice(cursor, end)
  return { text: marked, truncated_head: start > 0, truncated_tail: end < text.length }
}
