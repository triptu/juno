import type { Block, RichTextElement } from '@juno/slack-schema'
import { describe, expect, it } from 'vitest'
import { bodyFromMrkdwn, inlinesOf, messageBody, plainText, previewLine, previewText, type Lookups, type MessageBody } from '../src/index'

const lookups: Lookups = {
  me: 'U0ME',
  user: (id) => ({ U0ME: 'Tushar', U0MAYA: 'Maya Chen', U0LEO: 'Leo Park' })[id],
  channel: (id) => ({ C0ENG: 'eng', C0INC: 'incidents' })[id],
  usergroup: (id) => ({ S0ONCALL: 'oncall' })[id],
  emoji: (name) => (name === 'partyparrot' ? 'https://emoji.slack-edge.com/T1/partyparrot/abc.gif' : undefined),
}

/** The shape Slack sends for an ordinary message typed in the official client. */
function richText(elements: ReadonlyArray<RichTextElement>): Block[] {
  return [{ type: 'rich_text', block_id: 'abc', elements }]
}

describe('rich_text blocks', () => {
  it('renders a plain section as one paragraph', () => {
    const body = messageBody(
      { text: 'hello world', blocks: richText([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'hello world' }] }]) },
      lookups,
    )
    expect(body).toEqual<MessageBody>({ blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'hello world' }] }] })
  })

  it('keeps bold, italic, strike and code styles on text runs', () => {
    const body = messageBody(
      {
        blocks: richText([
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: 'a ' },
              { type: 'text', text: 'bold', style: { bold: true } },
              { type: 'text', text: ' ' },
              { type: 'text', text: 'italic', style: { italic: true } },
              { type: 'text', text: ' ' },
              { type: 'text', text: 'gone', style: { strike: true } },
              { type: 'text', text: ' ' },
              { type: 'text', text: 'npm i', style: { code: true } },
            ],
          },
        ]),
      },
      lookups,
    )
    expect(body.blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'a ' },
        { kind: 'text', text: 'bold', style: { bold: true } },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'italic', style: { italic: true } },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'gone', style: { strike: true } },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'npm i', style: { code: true } },
      ],
    })
  })

  it('resolves mentions through the lookups and flags mentions of me', () => {
    const body = messageBody(
      {
        blocks: richText([
          {
            type: 'rich_text_section',
            elements: [
              { type: 'user', user_id: 'U0ME' },
              { type: 'text', text: ' and ' },
              { type: 'user', user_id: 'U0MAYA' },
              { type: 'text', text: ' see ' },
              { type: 'channel', channel_id: 'C0ENG' },
              { type: 'text', text: ' ' },
              { type: 'usergroup', usergroup_id: 'S0ONCALL' },
              { type: 'text', text: ' ' },
              { type: 'broadcast', range: 'here' },
            ],
          },
        ]),
      },
      lookups,
    )
    expect(body.blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'user', id: 'U0ME', name: 'Tushar', isMe: true },
        { kind: 'text', text: ' and ' },
        { kind: 'user', id: 'U0MAYA', name: 'Maya Chen', isMe: false },
        { kind: 'text', text: ' see ' },
        { kind: 'channel', id: 'C0ENG', name: 'eng' },
        { kind: 'text', text: ' ' },
        { kind: 'usergroup', id: 'S0ONCALL', handle: 'oncall' },
        { kind: 'text', text: ' ' },
        { kind: 'broadcast', range: 'here' },
      ],
    })
  })

  it('shows "Someone", never the raw id, when a lookup does not know the person yet', () => {
    const body = messageBody({ blocks: richText([{ type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U0NEW' }] }]) }, lookups)
    expect(body.blocks[0]).toEqual({ kind: 'paragraph', children: [{ kind: 'user', id: 'U0NEW', name: 'Someone', isMe: false }] })
  })

  it('renders unicode emoji, skin tones from the hex form, and custom emoji by url', () => {
    const body = messageBody(
      {
        blocks: richText([
          {
            type: 'rich_text_section',
            elements: [
              { type: 'emoji', name: 'tada', unicode: '1f389' },
              { type: 'emoji', name: '+1', unicode: '1f44d-1f3fd', skin_tone: 4 },
              { type: 'emoji', name: 'partyparrot' },
              { type: 'emoji', name: 'no_such_emoji' },
            ],
          },
        ]),
      },
      lookups,
    )
    expect(body.blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'emoji', name: 'tada', unicode: '🎉' },
        { kind: 'emoji', name: '+1::skin-tone-4', unicode: '👍🏽' },
        { kind: 'emoji', name: 'partyparrot', url: 'https://emoji.slack-edge.com/T1/partyparrot/abc.gif' },
        { kind: 'emoji', name: 'no_such_emoji' },
      ],
    })
  })

  it('renders links with their label or url', () => {
    const body = messageBody(
      {
        blocks: richText([
          {
            type: 'rich_text_section',
            elements: [
              { type: 'link', url: 'https://example.com/a', text: 'the doc' },
              { type: 'text', text: ' ' },
              { type: 'link', url: 'https://example.com/b' },
            ],
          },
        ]),
      },
      lookups,
    )
    expect(body.blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'link', url: 'https://example.com/a', text: 'the doc' },
        { kind: 'text', text: ' ' },
        { kind: 'link', url: 'https://example.com/b', text: 'https://example.com/b' },
      ],
    })
  })

  it('turns newlines inside text into line breaks', () => {
    const body = messageBody({ blocks: richText([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'one\ntwo\n\nfour' }] }]) }, lookups)
    expect(body.blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'one' },
        { kind: 'break' },
        { kind: 'text', text: 'two' },
        { kind: 'break' },
        { kind: 'break' },
        { kind: 'text', text: 'four' },
      ],
    })
  })

  it('tidies blank lines: spaces are a blank line, runs collapse to one, and none at the edges', () => {
    const body = messageBody({ blocks: richText([{ type: 'rich_text_section', elements: [{ type: 'text', text: '\n \n\n  \nmany blank lines above\n\n\n\nand between\n   ' }] }]) }, lookups)
    expect(body.blocks).toEqual<MessageBody['blocks']>([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'many blank lines above' },
          { kind: 'break' },
          { kind: 'break' },
          { kind: 'text', text: 'and between' },
        ],
      },
    ])
  })

  it('keeps a space between two inlines on one line, and drops a message of only whitespace', () => {
    const spaced = messageBody({ blocks: richText([{ type: 'rich_text_section', elements: [{ type: 'emoji', name: 'tada', unicode: '1f389' }, { type: 'text', text: ' ' }, { type: 'text', text: 'nice' }] }]) }, lookups)
    expect(spaced.blocks[0]).toEqual({ kind: 'paragraph', children: [{ kind: 'emoji', name: 'tada', unicode: '🎉' }, { kind: 'text', text: ' nice' }] })
    expect(bodyFromMrkdwn(' \n\n   \n', lookups).blocks).toEqual([])
  })

  it('renders quote, preformatted, list, header and divider elements', () => {
    const body = messageBody(
      {
        blocks: richText([
          { type: 'rich_text_section', elements: [{ type: 'text', text: 'Plan:' }] },
          { type: 'rich_text_quote', elements: [{ type: 'text', text: 'the staging bill doubled' }] },
          { type: 'rich_text_preformatted', border: 0, elements: [{ type: 'text', text: 'SELECT 1;\nSELECT 2;' }] },
          {
            type: 'rich_text_list',
            style: 'ordered',
            indent: 0,
            border: 0,
            elements: [
              { type: 'rich_text_section', elements: [{ type: 'text', text: 'first' }] },
              { type: 'rich_text_section', elements: [{ type: 'text', text: 'second' }] },
            ],
          },
          { type: 'rich_text_list', style: 'check', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'todo' }] }] },
          { type: 'rich_text_header', elements: [{ type: 'text', text: 'Heading' }] },
          { type: 'rich_text_divider' },
        ]),
      },
      lookups,
    )
    expect(body.blocks).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Plan:' }] },
      { kind: 'quote', children: [{ kind: 'text', text: 'the staging bill doubled' }] },
      { kind: 'code', text: 'SELECT 1;\nSELECT 2;' },
      { kind: 'list', style: 'ordered', indent: 0, items: [[{ kind: 'text', text: 'first' }], [{ kind: 'text', text: 'second' }]] },
      { kind: 'list', style: 'unchecked', indent: 0, items: [[{ kind: 'text', text: 'todo' }]] },
      { kind: 'heading', children: [{ kind: 'text', text: 'Heading' }] },
      { kind: 'divider' },
    ])
  })

  it('shows the fallback of a date element and skips unknown kinds without text', () => {
    const body = messageBody(
      {
        blocks: richText([
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: 'Due ' },
              { type: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14, 2023' },
              { type: 'unknown', raw: { type: 'workflowtoken', workflow_id: 'W1' } },
            ],
          },
        ]),
      },
      lookups,
    )
    expect(plainText(body)).toBe('Due Nov 14, 2023')
  })

  it('renders a bot section block through mrkdwn and a header block as a heading', () => {
    const body = messageBody(
      {
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Deploy finished' } },
          { type: 'section', text: { type: 'mrkdwn', text: '*prod* is on <https://example.com/r/42|release 42>' } },
          { type: 'divider' },
          { type: 'context', elements: [{ type: 'image', alt_text: 'avatar' }, { type: 'mrkdwn', text: 'by <@U0LEO>' }] },
        ],
      },
      lookups,
    )
    expect(body.blocks).toEqual([
      { kind: 'heading', children: [{ kind: 'text', text: 'Deploy finished' }] },
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'prod', style: { bold: true } },
          { kind: 'text', text: ' is on ' },
          { kind: 'link', url: 'https://example.com/r/42', text: 'release 42' },
        ],
      },
      { kind: 'divider' },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'by ' }, { kind: 'user', id: 'U0LEO', name: 'Leo Park', isMe: false }] },
    ])
  })

  it('prefers blocks over text, and uses text when blocks render nothing', () => {
    const fromBlocks = messageBody({ text: 'ignored', blocks: richText([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'from blocks' }] }]) }, lookups)
    expect(plainText(fromBlocks)).toBe('from blocks')
    const fromText = messageBody({ text: 'from text', blocks: [{ type: 'rich_text', elements: [] }] }, lookups)
    expect(plainText(fromText)).toBe('from text')
    expect(messageBody({}, lookups)).toEqual({ blocks: [] })
  })
})

describe('mrkdwn text', () => {
  it.each<[string, MessageBody['blocks'][number]]>([
    ['plain &amp; escaped &lt;b&gt;', { kind: 'paragraph', children: [{ kind: 'text', text: 'plain & escaped <b>' }] }],
    ['hi <@U0MAYA>', { kind: 'paragraph', children: [{ kind: 'text', text: 'hi ' }, { kind: 'user', id: 'U0MAYA', name: 'Maya Chen', isMe: false }] }],
    ['<@U0ME|tushar> here', { kind: 'paragraph', children: [{ kind: 'user', id: 'U0ME', name: 'Tushar', isMe: true }, { kind: 'text', text: ' here' }] }],
    ['in <#C0ENG|eng>', { kind: 'paragraph', children: [{ kind: 'text', text: 'in ' }, { kind: 'channel', id: 'C0ENG', name: 'eng' }] }],
    ['in <#C0OTHER|random>', { kind: 'paragraph', children: [{ kind: 'text', text: 'in ' }, { kind: 'channel', id: 'C0OTHER', name: 'random' }] }],
    ['<!subteam^S0ONCALL|@oncall> ping', { kind: 'paragraph', children: [{ kind: 'usergroup', id: 'S0ONCALL', handle: 'oncall' }, { kind: 'text', text: ' ping' }] }],
    ['<!here> standup', { kind: 'paragraph', children: [{ kind: 'broadcast', range: 'here' }, { kind: 'text', text: ' standup' }] }],
    ['<!channel>', { kind: 'paragraph', children: [{ kind: 'broadcast', range: 'channel' }] }],
    ['<!everyone|@everyone>', { kind: 'paragraph', children: [{ kind: 'broadcast', range: 'everyone' }] }],
    ['see <https://example.com|the doc>', { kind: 'paragraph', children: [{ kind: 'text', text: 'see ' }, { kind: 'link', url: 'https://example.com', text: 'the doc' }] }],
    ['<https://example.com/x?a=1&amp;b=2>', { kind: 'paragraph', children: [{ kind: 'link', url: 'https://example.com/x?a=1&amp;b=2', text: 'https://example.com/x?a=1&amp;b=2' }] }],
    ['on <!date^1700000000^{date_short}|Nov 14, 2023>', { kind: 'paragraph', children: [{ kind: 'text', text: 'on ' }, { kind: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14, 2023' }] }],
    ['*bold* and _italic_ and ~strike~', {
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'bold', style: { bold: true } },
        { kind: 'text', text: ' and ' },
        { kind: 'text', text: 'italic', style: { italic: true } },
        { kind: 'text', text: ' and ' },
        { kind: 'text', text: 'strike', style: { strike: true } },
      ],
    }],
    ['run `npm i` now', { kind: 'paragraph', children: [{ kind: 'text', text: 'run ' }, { kind: 'text', text: 'npm i', style: { code: true } }, { kind: 'text', text: ' now' }] }],
    ['nice :tada: :partyparrot:', {
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'nice ' },
        { kind: 'emoji', name: 'tada', unicode: '🎉' },
        { kind: 'text', text: ' ' },
        { kind: 'emoji', name: 'partyparrot', url: 'https://emoji.slack-edge.com/T1/partyparrot/abc.gif' },
      ],
    }],
    ['a_b_c stays, 2*3*4 stays', { kind: 'paragraph', children: [{ kind: 'text', text: 'a_b_c stays, 2*3*4 stays' }] }],
    ['at 10:30 today', { kind: 'paragraph', children: [{ kind: 'text', text: 'at 10:30 today' }] }],
  ])('renders %j', (text, block) => {
    expect(bodyFromMrkdwn(text, lookups).blocks).toEqual([block])
  })

  it('nests styles', () => {
    expect(bodyFromMrkdwn('*bold _both_*', lookups).blocks).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'bold ', style: { bold: true } }, { kind: 'text', text: 'both', style: { bold: true, italic: true } }] },
    ])
  })

  it('merges consecutive quote lines into one soft quote block and keeps the reply after it', () => {
    const body = bodyFromMrkdwn('&gt; first line\n&gt; second line\nmy reply', lookups)
    expect(body.blocks).toEqual([
      { kind: 'quote', children: [{ kind: 'text', text: 'first line' }, { kind: 'break' }, { kind: 'text', text: 'second line' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'my reply' }] },
    ])
  })

  it('renders fenced code as one code block', () => {
    const body = bodyFromMrkdwn('before\n```\nconst a = 1 &lt; 2\n```\nafter', lookups)
    expect(body.blocks).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'before' }] },
      { kind: 'code', text: 'const a = 1 < 2' },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'after' }] },
    ])
    expect(bodyFromMrkdwn('```one liner```', lookups).blocks).toEqual([{ kind: 'code', text: 'one liner' }])
  })

  it('keeps newlines as breaks inside a paragraph', () => {
    expect(bodyFromMrkdwn('a\nb', lookups).blocks).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: 'a' }, { kind: 'break' }, { kind: 'text', text: 'b' }] }])
  })
})

describe('preview lines', () => {
  it('reads "Sender: text" with quote lines stripped', () => {
    const body = bodyFromMrkdwn('&gt; can we ship Friday?\nYes, Friday works.', lookups)
    expect(previewLine('Maya', body)).toBe('Maya: Yes, Friday works.')
  })

  it('collapses line breaks and whitespace', () => {
    const body = bodyFromMrkdwn('first line\nsecond   line', lookups)
    expect(previewText(body)).toBe('first line second line')
  })

  it('shows mentions, channels and emoji as text', () => {
    const body = bodyFromMrkdwn('<@U0MAYA> look at <#C0ENG|eng> :eyes: <!here>', lookups)
    expect(previewLine('You', body)).toBe('You: @Maya Chen look at #eng 👀 @here')
  })

  it('shows the sender only when the message was just a quote', () => {
    const body = bodyFromMrkdwn('&gt; quoted only', lookups)
    expect(previewLine('Leo', body)).toBe('Leo')
  })

  it('includes code and list items', () => {
    const body = messageBody(
      {
        blocks: [
          {
            type: 'rich_text',
            elements: [
              { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'ls -la' }] },
              { type: 'rich_text_list', style: 'bullet', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'one' }] }, { type: 'rich_text_section', elements: [{ type: 'text', text: 'two' }] }] },
            ],
          },
        ],
      },
      lookups,
    )
    expect(previewText(body)).toBe('ls -la one two')
  })
})

describe('plainText and inlinesOf', () => {
  it('keeps quote markers and newlines', () => {
    const body = bodyFromMrkdwn('&gt; q1\n&gt; q2\nreply', lookups)
    expect(plainText(body)).toBe('> q1\n> q2\nreply')
  })

  it('flattens every inline including list items', () => {
    const body = bodyFromMrkdwn('<@U0ME> hi', lookups)
    expect(inlinesOf(body).map((i) => i.kind)).toEqual(['user', 'text'])
  })
})
