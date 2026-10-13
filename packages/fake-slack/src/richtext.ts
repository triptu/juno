/**
 * Turns the fixtures' plain text into what Slack stores: the mrkdwn `text`
 * (HTML-escaped, `<@U…>` mentions) and one `rich_text` block. This is only
 * for the fake; the real conversion lives in @juno/richtext.
 *
 * Understood: `> ` quote lines, `<@U…>`, `<#C…|name>`, `<!subteam^S…|@handle>`, `<!here>`, `<!channel>`,
 * `<https://…|label>` and bare URLs.
 */
import type { Blocks, RichTextElement, RichTextInline } from '@juno/slack-schema'

const TOKEN = /<@([A-Z0-9]+)>|<#([A-Z0-9]+)\|([^>]*)>|<!(here|channel|everyone)>|<(https?:\/\/[^|>]+)(?:\|([^>]*))?>|(https?:\/\/\S+)|<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>/g

/** Escapes `&`, `<` and `>` in the literal parts of a line and leaves Slack's own `<…>` tokens alone. */
export function escapeText(text: string): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    out += escapeLiteral(text.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return out + escapeLiteral(text.slice(last))
}

function escapeLiteral(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function textToBlocks(text: string): Blocks {
  const elements: RichTextElement[] = []
  let section: RichTextInline[] = []
  let quote: RichTextInline[] = []
  const flushSection = () => {
    if (section.length > 0) elements.push({ type: 'rich_text_section', elements: section })
    section = []
  }
  const flushQuote = () => {
    if (quote.length > 0) elements.push({ type: 'rich_text_quote', elements: quote })
    quote = []
  }
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    const quoted = line.startsWith('> ')
    const body = quoted ? line.slice(2) : line
    const target = quoted ? quote : section
    if (quoted) flushSection()
    else flushQuote()
    const inline = parseInline(body)
    if (target.length > 0 && index > 0) target.push({ type: 'text', text: '\n' })
    target.push(...inline)
  })
  flushSection()
  flushQuote()
  return [{ type: 'rich_text', elements }]
}

function parseInline(text: string): RichTextInline[] {
  const out: RichTextInline[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) })
    const [, user, channel, , range, url, label, bareUrl, usergroup] = match
    if (user !== undefined) out.push({ type: 'user', user_id: user })
    else if (usergroup !== undefined) out.push({ type: 'usergroup', usergroup_id: usergroup })
    else if (channel !== undefined) out.push({ type: 'channel', channel_id: channel })
    else if (range !== undefined) out.push({ type: 'broadcast', range: range as 'here' | 'channel' | 'everyone' })
    else if (url !== undefined) out.push(label === undefined ? { type: 'link', url } : { type: 'link', url, text: label })
    else if (bareUrl !== undefined) out.push({ type: 'link', url: bareUrl })
    last = index + match[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** Quote lines become `&gt; ` in mrkdwn text. */
export function toMrkdwn(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('> ') ? `&gt; ${escapeText(line.slice(2))}` : escapeText(line)))
    .join('\n')
}
