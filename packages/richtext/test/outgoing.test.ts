import { describe, expect, it } from 'vitest'
import type { Block, RichTextInline } from '@juno/slack-schema'
import { composeOutgoing, editMarkup, type MentionTargets } from '../src/index'

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

describe('composer text to outgoing message', () => {
  it('sends plain text as one rich_text section plus the same text', () => {
    expect(composeOutgoing('hello world', targets)).toEqual({
      blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'hello world' }] }] }],
      text: 'hello world',
    })
  })

  it('sends nothing for empty or whitespace input', () => {
    expect(composeOutgoing('   \n', targets)).toEqual({ blocks: [], text: '' })
  })

  it('turns @Name and #channel tokens into mention elements, longest name first', () => {
    const out = composeOutgoing('@Maya Chen and @Maya Lindqvist, see #eng-infra not #eng', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'user', user_id: 'U0MAYA' },
        { type: 'text', text: ' and ' },
        { type: 'user', user_id: 'U0MAYA2' },
        { type: 'text', text: ', see ' },
        { type: 'channel', channel_id: 'C0ENGINFRA' },
        { type: 'text', text: ' not ' },
        { type: 'channel', channel_id: 'C0ENG' },
      ],
    })
    expect(out.text).toBe('<@U0MAYA> and <@U0MAYA2>, see <#C0ENGINFRA|eng-infra> not <#C0ENG|eng>')
  })

  it('sends the people and channels the composer picked by id, with no targets needed', () => {
    const out = composeOutgoing('ask <@U0MAYA|Maya> in <#C0ENG|eng> about <b>', {})
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'ask ' },
        { type: 'user', user_id: 'U0MAYA' },
        { type: 'text', text: ' in ' },
        { type: 'channel', channel_id: 'C0ENG' },
        { type: 'text', text: ' about <b>' },
      ],
    })
    expect(out.text).toBe('ask <@U0MAYA> in <#C0ENG|eng> about &lt;b&gt;')
  })

  it('sends a picked user group as the official client does: a usergroup element and the bare subteam mention', () => {
    const out = composeOutgoing('cc <!subteam^S0DESIGN|@design-team> today', {})
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'cc ' },
        { type: 'usergroup', usergroup_id: 'S0DESIGN' },
        { type: 'text', text: ' today' },
      ],
    })
    expect(out.text).toBe('cc <!subteam^S0DESIGN> today')
  })

  it('matches a first name only when it is unambiguous', () => {
    expect(composeOutgoing('thanks @Leo', targets).blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'thanks ' }, { type: 'user', user_id: 'U0LEO' }],
    })
    // Two Mayas: "@Maya" alone picks the first listed, which is the caller's recency order.
    expect(composeOutgoing('thanks @Maya', targets).blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'thanks ' }, { type: 'user', user_id: 'U0MAYA' }],
    })
  })

  it('does not treat emails or words as mentions', () => {
    const out = composeOutgoing('mail leo@eng.example or #engineering', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'mail leo@eng.example or #engineering' }],
    })
  })

  it('sends @here, @channel and @everyone as broadcasts', () => {
    const out = composeOutgoing('@here standup', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'broadcast', range: 'here' }, { type: 'text', text: ' standup' }],
    })
    expect(out.text).toBe('<!here> standup')
  })

  it('turns "> " lines into a quote element and keeps the reply as a section', () => {
    const out = composeOutgoing('> can we ship Friday?\n> or Monday\nFriday works.', targets)
    expect(out.blocks[0]?.elements).toEqual([
      { type: 'rich_text_quote', elements: [{ type: 'text', text: 'can we ship Friday?\nor Monday' }] },
      { type: 'rich_text_section', elements: [{ type: 'text', text: 'Friday works.' }] },
    ])
    expect(out.text).toBe('&gt; can we ship Friday?\n&gt; or Monday\nFriday works.')
  })

  it('keeps newlines inside one section', () => {
    expect(composeOutgoing('one\ntwo', targets).blocks[0]?.elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'one\ntwo' }] }])
  })

  it('escapes angle brackets and ampersands in the text fallback only', () => {
    const out = composeOutgoing('a < b & c > d', targets)
    expect(out.blocks[0]?.elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'a < b & c > d' }] }])
    expect(out.text).toBe('a &lt; b &amp; c &gt; d')
  })

  it('sends known and custom emoji shortcodes as emoji elements and leaves unknown ones as text', () => {
    const out = composeOutgoing('ship it :rocket: :partyparrot: :nope: 10:30', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'ship it ' },
        { type: 'emoji', name: 'rocket', unicode: '1f680' },
        { type: 'text', text: ' ' },
        { type: 'emoji', name: 'partyparrot' },
        { type: 'text', text: ' :nope: 10:30' },
      ],
    })
    expect(out.text).toBe('ship it :rocket: :partyparrot: :nope: 10:30')
  })
})

type Element = Record<string, unknown>
const section = (...elements: Element[]) => ({ type: 'rich_text_section', elements })
const sentElements = (input: string, to: MentionTargets = targets) => composeOutgoing(input, to).blocks[0]?.elements

/** Composer text, the elements it is sent as, and its mrkdwn `text`. */
const markupCases: ReadonlyArray<{ readonly name: string; readonly input: string; readonly elements: ReadonlyArray<unknown>; readonly text?: string }> = [
  {
    name: 'bold, italic, strikethrough and inline code',
    input: '*bold* _it_ ~gone~ `code`',
    elements: [
      section(
        { type: 'text', text: 'bold', style: { bold: true } },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'it', style: { italic: true } },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'gone', style: { strike: true } },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'code', style: { code: true } },
      ),
    ],
    text: '*bold* _it_ ~gone~ `code`',
  },
  {
    name: 'nested styles',
    input: '*bold _and italic_* then _*both*_',
    elements: [
      section(
        { type: 'text', text: 'bold ', style: { bold: true } },
        { type: 'text', text: 'and italic', style: { bold: true, italic: true } },
        { type: 'text', text: ' then ' },
        { type: 'text', text: 'both', style: { bold: true, italic: true } },
      ),
    ],
  },
  {
    name: 'markers inside words, numbers and alone',
    input: 'snake_case_name and 2*3*4 and a lone * and *spaced *',
    elements: [section({ type: 'text', text: 'snake_case_name and 2*3*4 and a lone * and *spaced *' })],
  },
  {
    name: 'markers at punctuation',
    input: '(*yes*), _this_.',
    elements: [
      section(
        { type: 'text', text: '(' },
        { type: 'text', text: 'yes', style: { bold: true } },
        { type: 'text', text: '), ' },
        { type: 'text', text: 'this', style: { italic: true } },
        { type: 'text', text: '.' },
      ),
    ],
  },
  {
    name: 'doubled markers are text',
    input: '**loud** and __this__',
    elements: [section({ type: 'text', text: '**loud** and __this__' })],
  },
  {
    name: 'no styling inside code',
    input: '`*not bold* _nor this_` but *this*',
    elements: [
      section(
        { type: 'text', text: '*not bold* _nor this_', style: { code: true } },
        { type: 'text', text: ' but ' },
        { type: 'text', text: 'this', style: { bold: true } },
      ),
    ],
  },
  {
    name: 'code inside a styled run',
    input: '*run `npm test` first*',
    elements: [
      section(
        { type: 'text', text: 'run ', style: { bold: true } },
        { type: 'text', text: 'npm test', style: { bold: true, code: true } },
        { type: 'text', text: ' first', style: { bold: true } },
      ),
    ],
  },
  {
    name: 'no styling across lines',
    input: '*one\ntwo*',
    elements: [section({ type: 'text', text: '*one\ntwo*' })],
  },
  {
    name: 'a fenced block on its own lines',
    input: 'before\n```\nconst a = *b*\n  return a\n```\nafter',
    elements: [
      section({ type: 'text', text: 'before' }),
      { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'const a = *b*\n  return a' }], border: 0 },
      section({ type: 'text', text: 'after' }),
    ],
    text: 'before\n```const a = *b*\n  return a```\nafter',
  },
  {
    name: 'a fenced block with no newline before the closing fence, and nothing after it',
    input: '```\nls -la```',
    elements: [{ type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'ls -la' }], border: 0 }],
    text: '```ls -la```',
  },
  {
    name: 'a fenced block with a trailing newline after the closing fence',
    input: '```ls -la```\n',
    elements: [{ type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'ls -la' }], border: 0 }],
  },
  {
    name: 'a fence in the middle of a line splits it',
    input: 'run ```make && make test``` then ship',
    elements: [
      section({ type: 'text', text: 'run ' }),
      { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'make && make test' }], border: 0 },
      section({ type: 'text', text: ' then ship' }),
    ],
    text: 'run \n```make &amp;&amp; make test```\n then ship',
  },
  {
    name: 'an unclosed fence is text',
    input: '```not closed',
    elements: [section({ type: 'text', text: '```not closed' })],
  },
  {
    name: 'a quote line with styles',
    input: '> *ship* it _today_\nok',
    elements: [
      {
        type: 'rich_text_quote',
        elements: [{ type: 'text', text: 'ship', style: { bold: true } }, { type: 'text', text: ' it ' }, { type: 'text', text: 'today', style: { italic: true } }],
      },
      section({ type: 'text', text: 'ok' }),
    ],
    text: '&gt; *ship* it _today_\nok',
  },
  {
    name: 'a mention and a link inside styled runs',
    input: '*ask <@U0MAYA|Maya>* about _https://example.com/a_b_',
    elements: [
      section(
        { type: 'text', text: 'ask ', style: { bold: true } },
        { type: 'user', user_id: 'U0MAYA', style: { bold: true } },
        { type: 'text', text: ' about ' },
        { type: 'link', url: 'https://example.com/a_b', style: { italic: true } },
      ),
    ],
    text: '*ask <@U0MAYA>* about _<https://example.com/a_b>_',
  },
  {
    name: 'linked words and emoji inside styled runs',
    input: '~<https://example.com/plan|the plan>~ *done :rocket:*',
    elements: [
      section(
        { type: 'link', url: 'https://example.com/plan', text: 'the plan', style: { strike: true } },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'done ', style: { bold: true } },
        { type: 'emoji', name: 'rocket', unicode: '1f680', style: { bold: true } },
      ),
    ],
  },
  {
    name: 'markers inside a link, a mention or a shortcode do not count',
    input: 'see https://example.com/_draft_ and :white_check_mark: with <@U0MAYA|_Maya_>',
    elements: [
      section(
        { type: 'text', text: 'see ' },
        { type: 'link', url: 'https://example.com/_draft_' },
        { type: 'text', text: ' and ' },
        { type: 'emoji', name: 'white_check_mark', unicode: '2705' },
        { type: 'text', text: ' with ' },
        { type: 'user', user_id: 'U0MAYA' },
      ),
    ],
  },
  {
    name: 'a link inside code keeps the code style, and an emoji there stays its shortcode',
    input: '`curl example.com :rocket:`',
    elements: [
      section(
        { type: 'text', text: 'curl ', style: { code: true } },
        { type: 'link', url: 'http://example.com', text: 'example.com', style: { code: true } },
        { type: 'text', text: ' :rocket:', style: { code: true } },
      ),
    ],
  },
]

describe('Slack markup in composer text', () => {
  for (const { name, input, elements, text } of markupCases) {
    it(name, () => {
      const out = composeOutgoing(input, targets)
      expect(out.blocks[0]?.elements).toEqual(elements)
      if (text !== undefined) expect(out.text).toBe(text)
    })
  }

  it('styles an edit’s @names', () => {
    expect(sentElements('*thanks @Maya Chen*')).toEqual([
      section({ type: 'text', text: 'thanks ', style: { bold: true } }, { type: 'user', user_id: 'U0MAYA', style: { bold: true } }),
    ])
  })
})

describe('editing a sent message', () => {
  const names: Record<string, string> = { U0MAYA: 'Maya Chen', C0ENG: 'eng' }
  const lookups = { user: (id: string) => names[id], channel: (id: string) => names[id] }
  /** What the edit field shows for a message sent from `typed`, and what saving it unchanged sends. */
  const roundTrip = (typed: string) => {
    const sent = composeOutgoing(typed, targets)
    const shown = editMarkup({ text: sent.text, blocks: sent.blocks as ReadonlyArray<Block> }, lookups)
    const inlines = sent.blocks.flatMap((block) => block.elements).flatMap((el): ReadonlyArray<RichTextInline> => (el.type === 'rich_text_section' || el.type === 'rich_text_quote' ? el.elements : []))
    const links = inlines.flatMap((el) => (el.type === 'link' && el.text !== undefined ? [{ text: el.text, url: el.url }] : []))
    return { sent, shown, saved: composeOutgoing(shown, { ...targets, links }) }
  }
  const cases: ReadonlyArray<{ readonly name: string; readonly typed: string; readonly shown: string }> = [
    { name: 'each style', typed: '*bold* _it_ ~gone~ `code`', shown: '*bold* _it_ ~gone~ `code`' },
    { name: 'nested styles', typed: '*bold _and italic_* then _*both*_', shown: '*bold _and italic_* then *_both_*' },
    { name: 'markers that did not count', typed: 'snake_case_name and 2*3*4 and *', shown: 'snake_case_name and 2*3*4 and *' },
    { name: 'a mention and a link inside styles', typed: '*ask <@U0MAYA|Maya>* about _https://example.com/a_b_', shown: '*ask @Maya Chen* about _https://example.com/a_b_' },
    { name: 'linked words', typed: '~<https://example.com/plan|the plan>~ is done', shown: '~the plan~ is done' },
    { name: 'a mention in code', typed: 'ping `<@U0MAYA|Maya>`', shown: 'ping `@Maya Chen`' },
    { name: 'a code block and a quote with styles', typed: 'see\n```\nmake *all*\n```\n> *ship* it\nok', shown: 'see\n```\nmake *all*\n```\n> *ship* it\nok' },
    { name: 'a style over a line break', typed: '*one* two\n_three_', shown: '*one* two\n_three_' },
  ]
  for (const { name, typed, shown } of cases) {
    it(`shows ${name} as markup, and sends the same styles when saved unchanged`, () => {
      const trip = roundTrip(typed)
      expect(trip.shown).toBe(shown)
      expect(trip.saved.blocks).toEqual(trip.sent.blocks)
    })
  }

  it('keeps spaces at a styled run’s edges outside its markers, where they count', () => {
    const blocks: ReadonlyArray<Block> = [
      {
        type: 'rich_text',
        elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'a ' }, { type: 'text', text: ' bold ', style: { bold: true } }, { type: 'text', text: 'end', style: { bold: true, code: true } }] }],
      },
    ]
    expect(editMarkup({ blocks })).toBe('a  *bold `end`*')
  })

  it('reads a message with no rich_text as plain text', () => {
    expect(editMarkup({ text: 'from an *old* client' })).toBe('from an old client')
  })
})
