/**
 * The outgoing path as tables. `sent`: what is typed in the composer, the
 * rich_text and mrkdwn fallback Slack receives, how Juno shows the sent
 * message, what the edit field shows, and what saving an edit sends.
 * `received`: shapes only Slack's client and bots send, and what editing them
 * keeps. Last, a seeded generator mixes those shapes with styles markup cannot
 * express. Text is invented.
 */
import { describe, expect, it } from 'bun:test'
import { Message, type Block, type RichTextBlock, type RichTextElement, type RichTextInline } from '@juno/slack-schema'
import { Schema } from 'effect'
import { composeEdit, composeOutgoing, editMarkup, markupLayout, messageBody, plainText, type Lookups, type MentionTargets, type MessageBody, type MessageContent } from '../src/index'

const targets: MentionTargets = {
  people: [
    { id: 'U0MAYA', name: 'Maya Chen' },
    { id: 'U0MAYA2', name: 'Maya Lindqvist' },
    { id: 'U0LEO', name: 'Leo Park' },
  ],
  channels: [
    { id: 'C0ENG', name: 'eng' },
    { id: 'C0ENGINFRA', name: 'eng-infra' },
  ],
  customEmoji: (name) => name === 'partyparrot',
}
const names: Record<string, string> = { U0MAYA: 'Maya Chen', U0MAYA2: 'Maya Lindqvist', U0LEO: 'Leo Park', C0ENG: 'eng', C0ENGINFRA: 'eng-infra' }
const lookups: Lookups = { user: (id) => names[id], channel: (id) => names[id] }

type Element = Record<string, unknown>
const text = (value: string, style?: Record<string, boolean>): Element => (style === undefined ? { type: 'text', text: value } : { type: 'text', text: value, style })
const section = (...elements: Element[]) => ({ type: 'rich_text_section', elements })
const pre = (value: string) => ({ type: 'rich_text_preformatted', elements: [text(value)], border: 0 })
const bold = { bold: true }
const italic = { italic: true }
const code = { code: true }
const rocket = { type: 'emoji', name: 'rocket', unicode: '1f680' }

interface Sent {
  readonly typed: string
  /** The composer's targets; `targets` when absent. */
  readonly to?: MentionTargets
  /** The elements of the one rich_text block sent; `[]` sends no blocks. */
  readonly elements?: ReadonlyArray<unknown>
  /** Sent as typed, one unstyled text element, and the field shows no styling. */
  readonly literal?: true
  /** The mrkdwn fallback. */
  readonly text?: string
  /** What the edit field shows for the sent message. */
  readonly shown?: string
  /** How Juno shows the sent message. */
  readonly body?: MessageBody['blocks']
  /** The words Juno shows, where reading the fallback as Slack's mrkdwn gives other words. A literal row shows what was typed. */
  readonly plain?: string
}

const sent: ReadonlyArray<Sent> = [
  { typed: 'hello world', elements: [section(text('hello world'))], text: 'hello world' },
  { typed: '   \n', elements: [], text: '' },
  { typed: 'one\ntwo', elements: [section(text('one\ntwo'))] },
  { typed: 'a < b & c > d', elements: [section(text('a < b & c > d'))], text: 'a &lt; b &amp; c &gt; d' },

  // Mentions: longest name first, an ambiguous first name picks the first listed (the caller's recency order).
  {
    typed: '@Maya Chen and @Maya Lindqvist, see #eng-infra not #eng',
    elements: [section({ type: 'user', user_id: 'U0MAYA' }, text(' and '), { type: 'user', user_id: 'U0MAYA2' }, text(', see '), { type: 'channel', channel_id: 'C0ENGINFRA' }, text(' not '), { type: 'channel', channel_id: 'C0ENG' })],
    text: '<@U0MAYA> and <@U0MAYA2>, see <#C0ENGINFRA|eng-infra> not <#C0ENG|eng>',
  },
  { typed: 'thanks @Leo', elements: [section(text('thanks '), { type: 'user', user_id: 'U0LEO' })] },
  { typed: 'thanks @Maya', elements: [section(text('thanks '), { type: 'user', user_id: 'U0MAYA' })] },
  { typed: 'mail leo@eng.example or #engineering', literal: true },
  // Picked in the composer: sent by id, with no targets needed.
  {
    typed: 'ask <@U0MAYA|Maya> in <#C0ENG|eng> about <b>', to: {},
    elements: [section(text('ask '), { type: 'user', user_id: 'U0MAYA' }, text(' in '), { type: 'channel', channel_id: 'C0ENG' }, text(' about <b>'))],
    text: 'ask <@U0MAYA> in <#C0ENG|eng> about &lt;b&gt;',
  },
  // A picked user group, as the official client sends it: a usergroup element and the bare subteam mention.
  { typed: 'cc <!subteam^S0DESIGN|@design-team> today', to: {}, elements: [section(text('cc '), { type: 'usergroup', usergroup_id: 'S0DESIGN' }, text(' today'))], text: 'cc <!subteam^S0DESIGN> today' },
  { typed: '@here standup', elements: [section({ type: 'broadcast', range: 'here' }, text(' standup'))], text: '<!here> standup' },
  {
    typed: '> can we ship Friday?\n> or Monday\nFriday works.',
    elements: [{ type: 'rich_text_quote', elements: [text('can we ship Friday?\nor Monday')] }, section(text('Friday works.'))],
    text: '&gt; can we ship Friday?\n&gt; or Monday\nFriday works.',
  },
  {
    typed: 'ship it :rocket: :partyparrot: :nope: 10:30',
    elements: [section(text('ship it '), rocket, text(' '), { type: 'emoji', name: 'partyparrot' }, text(' :nope: 10:30'))],
    text: 'ship it :rocket: :partyparrot: :nope: 10:30',
  },

  // Markup.
  { typed: '*bold* _it_ ~gone~ `code`', elements: [section(text('bold', bold), text(' '), text('it', italic), text(' '), text('gone', { strike: true }), text(' '), text('code', code))], text: '*bold* _it_ ~gone~ `code`', shown: '*bold* _it_ ~gone~ `code`' },
  { typed: '*bold _and italic_* then _*both*_', elements: [section(text('bold ', bold), text('and italic', { bold: true, italic: true }), text(' then '), text('both', { bold: true, italic: true }))], shown: '*bold* *_and italic_* then *_both_*' },
  { typed: 'snake_case_name and 2*3*4 and a lone * and *spaced *', literal: true },
  { typed: 'snake_case_name and 2*3*4 and *', shown: 'snake_case_name and 2*3*4 and *' },
  { typed: '(*yes*), _this_.', elements: [section(text('('), text('yes', bold), text('), '), text('this', italic), text('.'))] },
  { typed: '**loud** and __this__', literal: true },
  // Literal boundaries: astral characters are one code point, a doubled marker is text at either end.
  { typed: '𠮷*bold*', literal: true },
  { typed: '*bold*𠮷', literal: true },
  { typed: '*bold**', literal: true },
  { typed: '_italic__', literal: true },
  { typed: '~strike~~', literal: true },
  { typed: '`*not bold* _nor this_` but *this*', elements: [section(text('*not bold* _nor this_', code), text(' but '), text('this', bold))] },
  { typed: '*run `npm test` first*', elements: [section(text('run ', bold), text('npm test', { bold: true, code: true }), text(' first', bold))] },
  { typed: '*one\ntwo*', literal: true },
  { typed: '*one* two\n_three_', shown: '*one* two\n_three_' },
  // Backslashes are literal, in text and in code.
  { typed: '\\\\fileserver\\share', literal: true },
  { typed: '\\*.ts', literal: true },
  { typed: '¯\\_(ツ)_/¯', elements: [section(text('¯\\'), text('(ツ)', italic), text('/¯'))], plain: '¯\\(ツ)/¯' },
  { typed: '\\*word*', elements: [section(text('\\'), text('word', bold))], plain: '\\word' },
  { typed: '`\\*literal\\*`', elements: [section(text('\\*literal\\*', code))] },
  { typed: '```\\*literal\\*```', elements: [pre('\\*literal\\*')] },

  // Code blocks.
  { typed: 'before\n```\nconst a = *b*\n  return a\n```\nafter', elements: [section(text('before')), pre('const a = *b*\n  return a'), section(text('after'))], text: 'before\n```const a = *b*\n  return a```\nafter' },
  { typed: '```\nls -la```', elements: [pre('ls -la')], text: '```ls -la```' },
  { typed: '```ls -la```\n', elements: [pre('ls -la')] },
  { typed: 'run ```make && make test``` then ship', elements: [section(text('run ')), pre('make && make test'), section(text(' then ship'))], text: 'run \n```make &amp;&amp; make test```\n then ship' },
  { typed: '```not closed', literal: true },
  { typed: 'see\n```\nmake *all*\n```\n> *ship* it\nok', shown: 'see\n```\nmake *all*\n```\n> *ship* it\nok' },
  { typed: '> *ship* it _today_\nok', elements: [{ type: 'rich_text_quote', elements: [text('ship', bold), text(' it '), text('today', italic)] }, section(text('ok'))], text: '&gt; *ship* it _today_\nok' },

  // Mentions, links and emoji inside styles; markers inside them do not count.
  {
    typed: '*ask <@U0MAYA|Maya>* about _https://example.com/a_b_',
    elements: [section(text('ask ', bold), { type: 'user', user_id: 'U0MAYA', style: bold }, text(' about '), { type: 'link', url: 'https://example.com/a_b', style: italic })],
    text: '*ask <@U0MAYA>* about _<https://example.com/a_b>_',
    shown: '*ask @Maya Chen* about _https://example.com/a_b_',
  },
  { typed: '*thanks @Maya Chen*', elements: [section(text('thanks ', bold), { type: 'user', user_id: 'U0MAYA', style: bold })] },
  { typed: 'ping `<@U0MAYA|Maya>`', shown: 'ping `@Maya Chen`', plain: 'ping @Maya Chen' },
  { typed: '~<https://example.com/plan|the plan>~ *done :rocket:*', elements: [section({ type: 'link', url: 'https://example.com/plan', text: 'the plan', style: { strike: true } }, text(' '), text('done ', bold), { ...rocket, style: bold })] },
  { typed: '~<https://example.com/plan|the plan>~ is done', shown: '~the plan~ is done' },
  {
    typed: 'see https://example.com/_draft_ and :white_check_mark: with <@U0MAYA|_Maya_>',
    elements: [section(text('see '), { type: 'link', url: 'https://example.com/_draft_' }, text(' and '), { type: 'emoji', name: 'white_check_mark', unicode: '2705' }, text(' with '), { type: 'user', user_id: 'U0MAYA' })],
  },
  // A URL closes a style; typed URLs and emoji inside code stay text.
  { typed: '*see https://example.com/x*', elements: [section(text('see ', bold), { type: 'link', url: 'https://example.com/x', style: bold })] },
  { typed: '`curl https://example.com/a`', elements: [section(text('curl https://example.com/a', code))] },
  { typed: '`curl example.com :rocket:`', elements: [section(text('curl example.com :rocket:', code))] },

  // Links as Slack's client sends them: a URL with its scheme has no text, a domain keeps its text.
  {
    typed: 'see example.com and https://slack.com/help',
    elements: [section(text('see '), { type: 'link', url: 'http://example.com', text: 'example.com' }, text(' and '), { type: 'link', url: 'https://slack.com/help' })],
    text: 'see <http://example.com|example.com> and <https://slack.com/help>',
  },
  { typed: 'read <https://example.com/a?b=1&c=2|the docs &amp; notes> first', elements: [section(text('read '), { type: 'link', url: 'https://example.com/a?b=1&c=2', text: 'the docs & notes' }, text(' first'))] },
  { typed: '<https://example.com|a &gt; b>', text: '<https://example.com|a &gt; b>' },
  { typed: 'https://example.com/@Maya/:tada:/x', to: { people: [{ id: 'U0MAYA', name: 'Maya' }] }, elements: [section({ type: 'link', url: 'https://example.com/@Maya/:tada:/x' })] },
  // An edit's linked words are linked again.
  { typed: 'see the docs now', to: { links: [{ text: 'the docs', url: 'https://example.com/docs' }] }, elements: [section(text('see '), { type: 'link', url: 'https://example.com/docs', text: 'the docs' }, text(' now'))] },
  {
    typed: 'see example.com and <https://example.com/docs|the docs>',
    body: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'see ' }, { kind: 'link', url: 'http://example.com', text: 'example.com' }, { kind: 'text', text: ' and ' }, { kind: 'link', url: 'https://example.com/docs', text: 'the docs' }] }],
  },
]

/** The words an edit links again: what the composer passes as `targets.links`. */
const linksOf = (blocks: ReadonlyArray<RichTextBlock>) =>
  blocks
    .flatMap((block) => block.elements)
    .flatMap((el): ReadonlyArray<RichTextInline> => (el.type === 'rich_text_section' || el.type === 'rich_text_quote' ? el.elements : []))
    .flatMap((el) => (el.type === 'link' && el.text !== undefined ? [{ text: el.text, url: el.url }] : []))

describe('typed in the composer, sent, shown and edited', () => {
  for (const row of sent) {
    it(JSON.stringify(row.typed), () => {
      const to = row.to ?? targets
      const out = composeOutgoing(row.typed, to)
      const elements = row.literal ? [section(text(row.typed))] : row.elements
      if (elements !== undefined) expect(out.blocks).toEqual(elements.length === 0 ? [] : [{ type: 'rich_text', elements } as RichTextBlock])
      if (row.literal) expect(markupLayout(row.typed).spans).toEqual([])
      if (row.text !== undefined) expect(out.text).toBe(row.text)

      // Shown with no words lost: the blocks and the fallback text say the same words.
      const body = messageBody(out, lookups)
      if (row.body !== undefined) expect(body.blocks).toEqual(row.body)
      expect(plainText(body)).toBe(row.plain ?? (row.literal ? row.typed : plainText(messageBody({ text: out.text }, lookups))))

      if (out.blocks.length === 0) return
      const shown = editMarkup(out, lookups)
      if (row.shown !== undefined) expect(shown).toBe(row.shown)
      const editTargets = { ...to, links: linksOf(out.blocks) }
      // Saved unchanged, it sends the same blocks; with a line added, the rest is kept as sent.
      expect(composeEdit(shown, out, lookups, editTargets).blocks).toEqual(out.blocks)
      expect(composeEdit(`${shown}\nP.S.`, out, lookups, editTargets).blocks).toEqual([{ type: 'rich_text', elements: [...out.blocks[0]!.elements, section(text('P.S.'))] } as RichTextBlock])
    })
  }
})

const paragraph = (value: string): RichTextElement => ({ type: 'rich_text_section', elements: [{ type: 'text', text: value }] })
const rich = (...elements: ReadonlyArray<unknown>) => ({ type: 'rich_text', elements }) as RichTextBlock
const decodeBlocks = (...blocks: ReadonlyArray<object>) => Schema.decodeUnknownSync(Message)({ ts: '1760000000.000100', text: 'Status', blocks }).blocks!

/** Shapes Slack's client sends that Juno's markup never makes. Each is kept when another paragraph changes, and reparsed when it changes. */
const shapes: ReadonlyArray<RichTextElement> = [
  { type: 'rich_text_section', elements: [{ type: 'text', text: '*literal*' }] },
  { type: 'rich_text_section', elements: [{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar', style: { bold: true } }, { type: 'text', text: 'baz' }] },
  { type: 'rich_text_section', elements: [{ type: 'text', text: 'a` b', style: { code: true } }] },
  { type: 'rich_text_preformatted', border: 0, elements: [{ type: 'text', text: 'a```b\n  c' }] },
  { type: 'rich_text_section', elements: [{ type: 'text', text: ' bold ', style: { bold: true } }, { type: 'user', user_id: 'U0MAYA', style: { italic: true } }, { type: 'link', text: 'plan', url: 'https://example.com', style: { code: true } }] },
  { type: 'rich_text_quote', elements: [{ type: 'text', text: 'quoted\nline', style: { strike: true } }] },
  { type: 'rich_text_list', style: 'ordered', indent: 1, elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'item' }] }] },
  { type: 'rich_text_section', elements: [{ type: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14' }, { type: 'emoji', name: 'rocket', unicode: '1f680' }] },
]

interface Received {
  readonly name: string
  readonly original: MessageContent
  /** What the edit field shows. */
  readonly shown?: string
  /** An edit typed in the field, and the blocks it sends: `reparsed` when that is what `composeOutgoing` makes of the input. */
  readonly edits?: ReadonlyArray<{ readonly input: string; readonly expect: ReadonlyArray<unknown> | 'reparsed' }>
}

const canvas: RichTextElement = { type: 'rich_text_section', elements: [{ type: 'unknown', raw: { type: 'canvas', file_id: 'FTEST' } }] }
const list: Extract<RichTextElement, { type: 'rich_text_list' }> = { type: 'rich_text_list', style: 'ordered', indent: 1, elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'first' }] }, { type: 'rich_text_section', elements: [{ type: 'text', text: 'second' }] }] }
const planLink = (url: string): RichTextElement => ({ type: 'rich_text_section', elements: [{ type: 'link', text: 'plan', url }] })
const statusTable = { type: 'table', rows: [[rich(section(text('API'))), rich(section(text('Healthy')))]] }
const words = (...lines: ReadonlyArray<string>) => rich(...lines.map((line) => section(text(line))))

const received: ReadonlyArray<Received> = [
  ...['\\\\fileserver\\share', '\\*.ts', '¯\\_(ツ)_/¯', '\\*word*'].map((value) => ({ name: `backslashes in ${value}`, original: { blocks: [rich(paragraph(value))] }, shown: value })),
  { name: 'spaces at a styled run’s edges, outside its markers', original: { blocks: [rich(section(text('a '), text(' bold ', bold), text('end', { bold: true, code: true })))] }, shown: 'a  *bold* *`end`*' },
  { name: 'adjacent elements with the same style', original: { blocks: [rich(section(text('ship it', bold), { ...rocket, style: bold }))] }, shown: '*ship it🚀*' },
  { name: 'a message with no rich_text', original: { text: 'from an *old* client' }, shown: 'from an old client' },
  { name: 'a changed multiline paragraph', original: { blocks: [rich(paragraph('first\nsecond'))] }, edits: ['```\nfirst\nsecond\n```', '> first\nsecond', '`first`\nsecond'].map((input) => ({ input, expect: 'reparsed' as const })) },
  { name: 'a paragraph changed at both ends', original: { blocks: [rich(shapes[1])] }, edits: [{ input: 'Foo*bar*baZ', expect: 'reparsed' }] },
  { name: 'duplicate labels in a changed paragraph', original: { blocks: [rich(section(text('same '), text('same', bold)))] }, edits: [{ input: '*same* same!', expect: 'reparsed' }] },
  { name: 'an invisible element in an untouched paragraph', original: { blocks: [rich(canvas, paragraph('end'))] }, edits: [{ input: '\nchanged', expect: [rich(canvas, paragraph('changed'))] }] },
  { name: 'an unchanged paragraph between two changed ones', original: { blocks: [rich(paragraph('before'), shapes[6], paragraph('after'))] }, edits: [{ input: 'Before\nitem\nAfter', expect: [rich(paragraph('Before'), shapes[6], paragraph('After'))] }] },
  { name: 'an unchanged list item when another changes', original: { blocks: [rich(list)] }, edits: [{ input: 'changed\nsecond', expect: [rich(paragraph('changed'), { ...list, elements: [list.elements[1]], offset: 1 })] }] },
  {
    name: 'repeated unchanged paragraphs, in order',
    original: { blocks: [rich(paragraph('before'), planLink('https://example.com/first'), planLink('https://example.com/second'), paragraph('after'))] },
    edits: [{ input: 'Before\nplan\nplan\nAfter', expect: [rich(paragraph('Before'), planLink('https://example.com/first'), planLink('https://example.com/second'), paragraph('After'))] }],
  },
  { name: 'punctuation typed at a quote’s end', original: { blocks: [rich({ type: 'rich_text_quote', elements: [text('quoted')] })] }, edits: [{ input: '> quoted!', expect: [rich({ type: 'rich_text_quote', elements: [text('quoted!')] })] }] },
  // Blocks the field does not show go back unchanged, in their place.
  { name: 'a table alone shows the message text', original: { text: 'Release status', blocks: decodeBlocks(statusTable) }, shown: 'Release status' },
  {
    name: 'a table after the words',
    original: { text: 'Status', blocks: decodeBlocks(words('Status'), statusTable) },
    shown: 'Status',
    edits: [{ input: 'Status updated', expect: decodeBlocks(words('Status updated'), statusTable) }],
  },
  { name: 'a table between two blocks of words', original: { text: 'Status', blocks: decodeBlocks(words('Before'), statusTable, words('After')) }, edits: [{ input: 'Before\nAfter now', expect: decodeBlocks(words('Before'), statusTable, words('After now')) }] },
  { name: 'a table before the words', original: { text: 'Status', blocks: decodeBlocks(statusTable, words('Status')) }, edits: [{ input: 'Status updated', expect: decodeBlocks(statusTable, words('Status updated')) }] },
]

describe('Slack-sent shapes, edited', () => {
  for (const row of received) {
    it(row.name, () => {
      const shown = editMarkup(row.original, lookups)
      if (row.shown !== undefined) expect(shown).toBe(row.shown)
      if (row.original.blocks !== undefined) expect(composeEdit(shown, row.original, lookups).blocks).toBe(row.original.blocks)
      for (const edit of row.edits ?? []) {
        const edited = composeEdit(edit.input, row.original, lookups)
        expect(edited.blocks).toEqual((edit.expect === 'reparsed' ? composeOutgoing(edit.input).blocks : edit.expect) as ReadonlyArray<Block>)
        // A block the field does not show is sent back as the same object.
        for (const block of row.original.blocks ?? []) if (block.type !== 'rich_text') expect(edited.blocks).toContain(block)
      }
    })
  }

  for (const [index, shape] of shapes.entries()) {
    it(`keeps Slack shape ${index} when another paragraph changes, and reparses it when it changes`, () => {
      const original = { blocks: [rich(shape, paragraph('end'))] }
      expect(composeEdit(`${editMarkup(original, lookups)}!`, original, lookups).blocks.flatMap(richElements)[0]).toEqual(shape)
      const alone = { blocks: [rich(shape)] }
      const input = `${editMarkup(alone, lookups)}!`
      expect(composeEdit(input, alone, lookups).blocks).toEqual(composeOutgoing(input).blocks)
    })
  }
})

/** The rich-text elements of an edit's blocks, in order. */
const richElements = (block: Block) => (block.type === 'rich_text' ? block.elements : [])

it('round trips generated Slack blocks, including styles markup cannot express', () => {
  let seed = 811
  const next = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed % n
  }
  const texts = ['*literal*', 'foo', '  ', 'a` b', '```', 'שלום', '𠮷', 'line\nbreak', '\\', ':rocket:', 'https://example.com']
  for (let run = 0; run < 150; run++) {
    const elements: RichTextInline[] = Array.from({ length: 1 + next(8) }, () => ({ type: 'text', text: texts[next(texts.length)]!, style: { bold: next(2) === 1, italic: next(2) === 1, code: next(2) === 1 } }))
    const blocks: RichTextBlock[] = [rich({ type: 'rich_text_section', elements }, shapes[next(shapes.length)]!)]
    // Unchanged.
    expect(composeEdit(editMarkup({ blocks }, lookups), { blocks }, lookups).blocks).toEqual(blocks)
    // The paragraph itself changed: parsed as new markup.
    const alone = { blocks: [rich({ type: 'rich_text_section', elements })] }
    const changed = `${editMarkup(alone, lookups)}!`
    expect(composeEdit(changed, alone, lookups).blocks).toEqual(composeOutgoing(changed).blocks)
    // Another paragraph changed: these kept as Slack sent them.
    const withTrailer = { blocks: [rich(...blocks[0]!.elements, paragraph('trailer'))] }
    const edited = composeEdit(`${editMarkup(withTrailer, lookups)}!`, withTrailer, lookups)
    expect(edited.blocks.flatMap(richElements).slice(0, -1)).toEqual([...blocks[0]!.elements])
  }
})
