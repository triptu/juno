/**
 * Messages as Slack sends them, decoded with `@juno/slack-schema` (the path
 * the engine takes for every message) and read as a `MessageBody`. Each row
 * is a payload shape and what a person sees of it: the blocks, the inlines it
 * holds, and the text views (copy, notification, preview). Shapes follow the
 * research notes and recorded responses; ids and text are invented.
 */
import { describe, expect, it } from 'bun:test'
import { Message } from '@juno/slack-schema'
import { Schema } from 'effect'
import { inlinesOf, messageBody, messageTitle, plainText, previewLine, previewText, readableText, tableText, type Lookups, type MessageBody, type MessageContent, type PlaceName } from '../src/index'

const places: Record<string, PlaceName> = { C0ENG: { kind: 'public', name: 'eng' }, G0OPS: { kind: 'private', name: 'ops' }, D0MAYA: { kind: 'im', name: 'Maya Chen' } }
const lookups: Lookups = {
  me: 'U0ME',
  user: (id) => ({ U0ME: 'Tushar', U0MAYA: 'Maya Chen', U0LEO: 'Leo Park' })[id],
  channel: (id) => ({ C0ENG: 'eng', C0INC: 'incidents' })[id],
  usergroup: (id) => ({ S0ONCALL: { handle: 'oncall', name: 'On-call engineers' }, S0GONE: { handle: 'old-team' } })[id],
  myUsergroups: ['S0ONCALL'],
  emoji: (name) => (name === 'partyparrot' ? 'https://emoji.slack-edge.com/T1/partyparrot/abc.gif' : undefined),
  emojiAlias: (name) => (name === 'yes' ? 'thumbsup' : undefined),
  place: (id) => places[id],
}

type Shown = MessageBody['blocks'][number]
type Inline = ReturnType<typeof inlinesOf>[number]

interface Row {
  readonly name: string
  /** A message as Slack sends it, decoded through the schema; `ts` is added. */
  readonly slack?: object
  /** A message as the store kept it, not decoded again. */
  readonly stored?: MessageContent
  readonly lookups?: Lookups
  /** The whole body. */
  readonly blocks?: ReadonlyArray<Shown>
  readonly kinds?: ReadonlyArray<string>
  /** The body's first block of this kind, exactly. */
  readonly block?: Shown
  /** The body's first block, matched in part. */
  readonly like?: object
  /** Fields the body's first block does not have. */
  readonly lacks?: ReadonlyArray<string>
  /** Inlines the body holds. */
  readonly has?: ReadonlyArray<Inline>
  readonly plain?: string
  readonly readable?: string
  readonly preview?: string
  readonly line?: readonly [sender: string, line: string]
  /** Words in both the plain text and the preview. */
  readonly shows?: ReadonlyArray<string>
  /** Words that are not in the plain text. */
  readonly hides?: ReadonlyArray<string>
  /** Words in the plain text exactly once. */
  readonly once?: string
  readonly title?: string
  /** `tableText` of some of the first table's rows, as a copied selection. */
  readonly copied?: readonly [from: number, to: number, text: string]
}

const rich = (...elements: ReadonlyArray<object>) => ({ blocks: [{ type: 'rich_text', block_id: 'abc', elements }] })
const section = (...elements: ReadonlyArray<object>) => ({ type: 'rich_text_section', elements })
const t = (text: string, style?: object) => (style === undefined ? { type: 'text', text } : { type: 'text', text, style })
const pre = (text: string) => rich({ type: 'rich_text_preformatted', elements: [t(text)] })
const para = (...children: ReadonlyArray<Inline>): Shown => ({ kind: 'paragraph', children })
const text = (value: string, style?: { readonly [key: string]: boolean }): Inline => (style === undefined ? { kind: 'text', text: value } : { kind: 'text', text: value, style })
const bold = { bold: true }
const maya: Inline = { kind: 'user', id: 'U0MAYA', name: 'Maya Chen', isMe: false }
const oncall: Inline = { kind: 'usergroup', id: 'S0ONCALL', handle: 'oncall', name: 'On-call engineers', isMine: true }
const mrkdwn = (value: string, block: Shown): Row => ({ name: `mrkdwn ${JSON.stringify(value)}`, slack: { text: value }, blocks: [block] })

/** Shaped after a `conversations.history` message from the official client: elements and blocks the schema does not model keep their text. */
const history = {
  type: 'message', user: 'U0MAYA', ts: '1760000000.000100', client_msg_id: '2b5c1d7e-0000-4000-8000-000000000000', team: 'T0TEAM',
  text: '<@U0ME> the *staging bill* doubled, see <https://example.com/bill|the invoice> :chart_with_upwards_trend: and the file',
  blocks: [
    { type: 'rich_text', block_id: 'Qx3', elements: [
      section(
        { type: 'user', user_id: 'U0ME' }, t(' the '), t('staging bill', bold), t(' doubled, see '), { type: 'link', url: 'https://example.com/bill', text: 'the invoice' }, t(' '),
        { type: 'emoji', name: 'chart_with_upwards_trend', unicode: '1f4c8' }, t(' and the file '),
        { type: 'file', file_id: 'F0INVOICE', text: 'invoice-october.pdf' }, t(' plus '), { type: 'canvas', canvas_id: 'F0CANVAS', fallback: 'Q4 plan' },
      ),
      { type: 'rich_text_quote', elements: [t('from the finance thread')] },
      { type: 'rich_text_table_future', text: 'see the table' },
    ] },
    { type: 'actions', block_id: 'act', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Approve' } }] },
  ],
  reactions: [{ name: 'eyes', users: ['U0ME'], count: 1 }],
  brand_new_field: { from: 'a future Slack release' },
}

/** As the recorded bot reply in `subscriptions.thread.getView` has it: words, a table whose cells are rich_text blocks, then more words. */
const cell = (...elements: ReadonlyArray<object>) => ({ type: 'rich_text', block_id: 'c', elements: [section(...elements)] })
const release = {
  text: 'Release status',
  blocks: [
    cell(t('Release status:')),
    { type: 'table', block_id: 't', column_settings: [null, { align: 'center' }, { is_wrapped: true, align: 'justify' }], rows: [
      [cell(t('Service')), cell(t('Owner')), cell(t('Notes'))],
      [cell(t('API')), cell({ type: 'user', user_id: 'U0MAYA' }), cell(t('p95 at '), t('212 ms', { code: true }))],
      [cell(t('Worker', bold)), null, cell({ type: 'link', url: 'https://example.test/runbook', text: 'runbook' }, { type: 'emoji', name: 'warning', unicode: '26a0-fe0f' })],
    ] },
    cell(t('Rollback is ready.')),
  ],
}
const tableOf = (rows: ReadonlyArray<ReadonlyArray<unknown>>, extra: object = {}) => ({ text: 'Release status', blocks: [{ type: 'table', rows, ...extra }] })
const ownerTable = tableOf([[cell(t('Service')), cell(t('Owner'))], [cell(t('API')), cell({ type: 'user', user_id: 'U0MAYA' })], [cell(t('Worker')), null]])
const cells = (...row: ReadonlyArray<string>) => row.map((value) => [text(value)])

/** A shared Slack message: an attachment with the permalink, as the official client sends it. */
const words = 'Can someone look at the staging deploy?'
const sharedWords = [{ type: 'rich_text', elements: [section(t(words))] }]
const shared = {
  is_msg_unfurl: true, author_name: 'Maya', author_icon: 'https://example.test/maya.png',
  from_url: 'https://example.test/archives/C0ENG/p1792178160000100', ts: '1792178160.000100',
  footer: 'Thread in Slack conversation', fallback: `[October 16th, 2026 10:26 PM] Maya: ${words}`, text: words, mrkdwn_in: ['text'],
}
const permalink = 'https://acme.slack.com/archives/C0ENG/p1792178160000100'
const share = { is_share: true, is_msg_unfurl: true, author_name: 'Maya', text: 'Ship it', from_url: permalink, ts: '1792178160.000100', footer: 'Thread in Slack conversation' }
const sharedDate = { kind: 'date', timestamp: 1792178160.0001, format: '{date_short} at {time}', fallback: '' } as const
const { text: _, ...wordless } = shared
const sharedFrom = (attachment: object) => ({ text: '', attachments: [attachment] })
const diagram = (dimensions: object) => ({ text: 'See the diagram', files: [{ id: 'F0DIAGRAM', name: 'diagram.png', mimetype: 'image/png', ...dimensions }] })
const code = (value: string, language?: string): Shown => (language === undefined ? { kind: 'code', text: value } : { kind: 'code', text: value, language, tagLine: true })

const rows: ReadonlyArray<Row> = [
  {
    name: 'a conversations.history message, unknown kinds kept by their text',
    slack: history,
    kinds: ['paragraph', 'quote', 'paragraph', 'paragraph'],
    has: [{ kind: 'user', id: 'U0ME', name: 'Tushar', isMe: true }, text('staging bill', bold), { kind: 'link', url: 'https://example.com/bill', text: 'the invoice' }, { kind: 'emoji', name: 'chart_with_upwards_trend', unicode: '📈' }],
    plain: '@Tushar the staging bill doubled, see the invoice 📈 and the file invoice-october.pdf plus Q4 plan\n> from the finance thread\nsee the table\nApprove',
    preview: '@Tushar the staging bill doubled, see the invoice 📈 and the file invoice-october.pdf plus Q4 plan see the table Approve',
  },
  { name: 'blocks with nothing to show fall back to the mrkdwn text', slack: { text: 'plain *bold* text', blocks: [{ type: 'actions', elements: [] }] }, blocks: [para(text('plain '), text('bold', bold), text(' text'))] },
  { name: 'blocks win over text', slack: { text: 'ignored', ...rich(section(t('from blocks'))) }, plain: 'from blocks' },
  { name: 'an empty rich_text block uses the text', slack: { text: 'from text', blocks: [{ type: 'rich_text', elements: [] }] }, plain: 'from text' },
  { name: 'no text and no blocks', slack: {}, blocks: [] },

  // rich_text
  {
    name: 'mentions named through the lookups, mine flagged',
    slack: rich(section({ type: 'user', user_id: 'U0ME' }, t(' and '), { type: 'user', user_id: 'U0MAYA' }, t(' see '), { type: 'channel', channel_id: 'C0ENG' }, t(' '), { type: 'usergroup', usergroup_id: 'S0ONCALL' }, t(' '), { type: 'broadcast', range: 'here' })),
    blocks: [para({ kind: 'user', id: 'U0ME', name: 'Tushar', isMe: true }, text(' and '), maya, text(' see '), { kind: 'channel', id: 'C0ENG', name: 'eng' }, text(' '), oncall, text(' '), { kind: 'broadcast', range: 'here' })],
  },
  { name: 'a person not known yet is "Someone", never the id', slack: rich(section({ type: 'user', user_id: 'U0NEW' })), plain: '@Someone', has: [{ kind: 'user', id: 'U0NEW', name: 'Someone', isMe: false }] },
  {
    name: 'emoji: unicode, a skin tone from the hex form, custom by url, unknown by name',
    slack: rich(section({ type: 'emoji', name: 'tada', unicode: '1f389' }, { type: 'emoji', name: '+1', unicode: '1f44d-1f3fd', skin_tone: 4 }, { type: 'emoji', name: 'partyparrot' }, { type: 'emoji', name: 'no_such_emoji' })),
    blocks: [para({ kind: 'emoji', name: 'tada', unicode: '🎉' }, { kind: 'emoji', name: '+1::skin-tone-4', unicode: '👍🏽' }, { kind: 'emoji', name: 'partyparrot', url: 'https://emoji.slack-edge.com/T1/partyparrot/abc.gif' }, { kind: 'emoji', name: 'no_such_emoji' })],
  },
  { name: 'a workspace alias of a standard emoji', slack: rich(section({ type: 'emoji', name: 'yes' })), has: [{ kind: 'emoji', name: 'yes', unicode: '👍' }] },
  { name: 'newlines in text are line breaks', slack: rich(section(t('one\ntwo\n\nfour'))), blocks: [para(text('one'), { kind: 'break' }, text('two'), { kind: 'break' }, { kind: 'break' }, text('four'))] },
  {
    name: 'blank lines tidied: spaces are a blank line, runs collapse to one, none at the edges',
    slack: rich(section(t('\n \n\n  \nmany blank lines above\n\n\n\nand between\n   '))),
    blocks: [para(text('many blank lines above'), { kind: 'break' }, { kind: 'break' }, text('and between'))],
  },
  { name: 'a space between two inlines on one line', slack: rich(section({ type: 'emoji', name: 'tada', unicode: '1f389' }, t(' '), t('nice'))), blocks: [para({ kind: 'emoji', name: 'tada', unicode: '🎉' }, text(' nice'))] },
  { name: 'only whitespace', slack: { text: ' \n\n   \n' }, blocks: [] },
  {
    name: 'a URL in a text element is a link, but not in code',
    slack: rich(section(t('at https://example.com '), t('example.com', { code: true }))),
    blocks: [para(text('at '), { kind: 'link', url: 'https://example.com', text: 'https://example.com' }, text(' '), text('example.com', { code: true }))],
  },
  { name: 'a date by its fallback; an unknown kind with no text is skipped', slack: rich(section(t('Due '), { type: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14, 2023' }, { type: 'workflowtoken', workflow_id: 'W1' })), plain: 'Due Nov 14, 2023' },
  ...[
    ['rich', rich(section({ type: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14, 2023', url: 'https://example.test/calendar' }))],
    ['mrkdwn', { text: '<!date^1700000000^{date_short}^https://example.test/calendar|Nov 14, 2023>' }],
  ].map(([kind, slack]): Row => ({ name: `a date and its link from ${kind}`, slack: slack as object, plain: 'Nov 14, 2023', has: [{ kind: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14, 2023', url: 'https://example.test/calendar' }] })),
  {
    name: 'a usergroup element named from the list, or a placeholder',
    slack: { text: '<!subteam^S0DESIGN>', ...rich(section({ type: 'usergroup', usergroup_id: 'S0DESIGN' }, t(' and '), { type: 'usergroup', usergroup_id: 'S0ONCALL' })) },
    blocks: [para({ kind: 'usergroup', id: 'S0DESIGN', handle: 'group', isMine: false }, text(' and '), oncall)],
  },

  // Code blocks: a first line that is only a language tag names the language; the text keeps it, the reader does not see it.
  { name: 'a fenced block in mrkdwn', slack: { text: 'before\n```\nconst a = 1 &lt; 2\n```\nafter' }, blocks: [para(text('before')), code('const a = 1 < 2'), para(text('after'))] },
  { name: 'a one-line fence', slack: { text: '```one liner```' }, blocks: [code('one liner')] },
  { name: 'a ts tag in mrkdwn', slack: { text: '```ts\nconst a = 1\n```' }, blocks: [code('ts\nconst a = 1', 'typescript')], readable: 'const a = 1' },
  { name: 'a python tag in a block', slack: pre('python\nprint(1)'), blocks: [code('python\nprint(1)', 'python')], plain: 'python\nprint(1)', readable: 'print(1)' },
  { name: 'a capitalised tag', slack: pre('Python\nprint(1)'), block: code('Python\nprint(1)', 'python'), readable: 'print(1)' },
  { name: 'a tag with a trailing space', slack: pre('sh \nls -la'), block: code('sh \nls -la', 'bash'), readable: 'ls -la' },
  { name: 'a tag that asks for no colours', slack: pre('text\nconst a = 1'), block: code('text\nconst a = 1', 'plaintext'), readable: 'const a = 1' },
  { name: 'a lone tag word is the code', slack: { text: '```python```' }, blocks: [code('python')] },
  { name: 'a tag with no code after it is the code', slack: pre('json\n\n'), block: code('json') },
  ...['ts is fine\nreally', 'banana\nsplit', 'const a = 1\nconst b = 2'].map((value): Row => ({ name: `no tag in ${JSON.stringify(value)}`, slack: pre(value), block: code(value), readable: value })),

  // mrkdwn text
  ...([
    ['plain &amp; escaped &lt;b&gt;', para(text('plain & escaped <b>'))],
    ['hi <@U0MAYA>', para(text('hi '), maya)],
    ['<@U0ME|tushar> here', para({ kind: 'user', id: 'U0ME', name: 'Tushar', isMe: true }, text(' here'))],
    ['in <#C0ENG|eng>', para(text('in '), { kind: 'channel', id: 'C0ENG', name: 'eng' })],
    ['in <#C0OTHER|random>', para(text('in '), { kind: 'channel', id: 'C0OTHER', name: 'random' })],
    ['<!subteam^S0ONCALL|@oncall> ping', para(oncall, text(' ping'))],
    ['<!here> standup', para({ kind: 'broadcast', range: 'here' }, text(' standup'))],
    ['<!channel>', para({ kind: 'broadcast', range: 'channel' })],
    ['<!everyone|@everyone>', para({ kind: 'broadcast', range: 'everyone' })],
    ['see <https://example.com|the doc>', para(text('see '), { kind: 'link', url: 'https://example.com', text: 'the doc' })],
    ['read <https://example.com/a?b=1&amp;c=2|the docs>', para(text('read '), { kind: 'link', url: 'https://example.com/a?b=1&c=2', text: 'the docs' })],
    ['<https://example.com/x?a=1&amp;b=2>', para({ kind: 'link', url: 'https://example.com/x?a=1&b=2', text: 'https://example.com/x?a=1&b=2' })],
    ['<https://example.com|a &lt;b&gt; &amp; c>', para({ kind: 'link', url: 'https://example.com', text: 'a <b> & c' })],
    ['on <!date^1700000000^{date_short}|Nov 14, 2023>', para(text('on '), { kind: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14, 2023' })],
    ['*bold* and _italic_ and ~strike~', para(text('bold', bold), text(' and '), text('italic', { italic: true }), text(' and '), text('strike', { strike: true }))],
    ['*bold _both_*', para(text('bold ', bold), text('both', { bold: true, italic: true }))],
    ['run `npm i` now', para(text('run '), text('npm i', { code: true }), text(' now'))],
    ['nice :tada: :partyparrot:', para(text('nice '), { kind: 'emoji', name: 'tada', unicode: '🎉' }, text(' '), { kind: 'emoji', name: 'partyparrot', url: 'https://emoji.slack-edge.com/T1/partyparrot/abc.gif' })],
    ['a_b_c stays, 2*3*4 stays', para(text('a_b_c stays, 2*3*4 stays'))],
    ['at 10:30 today', para(text('at 10:30 today'))],
    ['a\nb', para(text('a'), { kind: 'break' }, text('b'))],
  ] as const).map(([value, block]) => mrkdwn(value, block)),
  {
    name: 'consecutive quote lines are one quote, the reply after it',
    slack: { text: '&gt; first line\n&gt; second line\nmy reply' },
    blocks: [{ kind: 'quote', children: [text('first line'), { kind: 'break' }, text('second line')] }, para(text('my reply'))],
  },

  // User groups in mrkdwn: named from the list, then the label, never by id.
  { name: 'a group from the list', slack: { text: '<!subteam^S0ONCALL> ping' }, has: [oncall] },
  { name: 'a group known only by its label', slack: { text: '<!subteam^S0DESIGN|@design> ping' }, has: [{ kind: 'usergroup', id: 'S0DESIGN', handle: 'design', isMine: false }] },
  { name: 'an unknown, unlabelled group', slack: { text: '<!subteam^S0DESIGN> ping' }, has: [{ kind: 'usergroup', id: 'S0DESIGN', handle: 'group', isMine: false }] },
  { name: 'an unlabelled group before the list arrives', slack: { text: '<!subteam^S0DESIGN> ping' }, lookups: {}, plain: '@group ping' },
  { name: 'a deleted group keeps its old handle', slack: { text: '<!subteam^S0GONE>' }, has: [{ kind: 'usergroup', id: 'S0GONE', handle: 'old-team', isMine: false }] },

  // Text views and previews.
  { name: 'quote markers kept in plain text', slack: { text: '&gt; q1\n&gt; q2\nreply' }, plain: '> q1\n> q2\nreply' },
  { name: 'a preview strips quotes', slack: { text: '&gt; can we ship Friday?\nYes, Friday works.' }, line: ['Maya', 'Maya: Yes, Friday works.'] },
  { name: 'a preview collapses breaks and spaces', slack: { text: 'first line\nsecond   line' }, preview: 'first line second line' },
  { name: 'a preview shows mentions, channels and emoji as text', slack: { text: '<@U0MAYA> look at <#C0ENG|eng> :eyes: <!here>' }, line: ['You', 'You: @Maya Chen look at #eng 👀 @here'] },
  { name: 'a preview of only a quote is the sender', slack: { text: '&gt; quoted only' }, line: ['Leo', 'Leo'] },
  {
    name: 'a preview includes code and list items',
    slack: rich({ type: 'rich_text_preformatted', elements: [t('ls -la')] }, { type: 'rich_text_list', style: 'bullet', elements: [section(t('one')), section(t('two'))] }),
    preview: 'ls -la one two', has: [text('one'), text('two')],
  },

  // Bot layout blocks.
  {
    name: 'a bot message: header, mrkdwn section, divider, context',
    slack: { blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Deploy finished' } }, { type: 'section', text: { type: 'mrkdwn', text: '*prod* is on <https://example.com/r/42|release 42>' } },
      { type: 'divider' }, { type: 'context', elements: [{ type: 'image', alt_text: 'avatar' }, { type: 'mrkdwn', text: 'by <@U0LEO>' }] },
    ] },
    blocks: [
      { kind: 'heading', children: [text('Deploy finished')] }, para(text('prod', bold), text(' is on '), { kind: 'link', url: 'https://example.com/r/42', text: 'release 42' }),
      { kind: 'divider' }, { kind: 'context', children: [text('avatar by '), { kind: 'user', id: 'U0LEO', name: 'Leo Park', isMe: false }] },
    ],
  },
  {
    name: 'shortcodes in plain_text headers and fields are emoji unless emoji is false',
    slack: { blocks: [{ type: 'header', text: { type: 'plain_text', text: ':dart: What to target' } }, { type: 'section', fields: [{ type: 'plain_text', text: 'ratio 3:2 :rocket:' }, { type: 'plain_text', text: ':dart:', emoji: false }] }] },
    blocks: [
      { kind: 'heading', children: [{ kind: 'emoji', name: 'dart', unicode: '\u{1F3AF}' }, text(' What to target')] },
      { kind: 'fields', items: [[text('ratio 3:2 '), { kind: 'emoji', name: 'rocket', unicode: '\u{1F680}' }], [text(':dart:')]] },
    ],
  },
  {
    name: 'section fields, context, images, URL buttons and unknown blocks',
    slack: { blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Issue* updated' }, fields: [{ type: 'plain_text', text: 'Owner' }, { type: 'mrkdwn', text: 'Team' }] }, { type: 'context', elements: [{ type: 'plain_text', text: 'Created today' }] },
      { type: 'image', image_url: 'https://example.test/chart.png', alt_text: 'Latency chart' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View issue' }, url: 'https://example.test/issue' }] },
      { type: 'future', text: 'Still readable' },
    ] },
    kinds: ['paragraph', 'fields', 'context', 'image', 'paragraph', 'paragraph'], shows: ['Still readable'], has: [{ kind: 'link', url: 'https://example.test/issue', text: 'View issue' }],
  },
  { name: 'a header names an integration root', slack: { blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Latency alert' } }] }, title: 'Latency alert' },

  // Files.
  ...([
    ['original dimensions', { original_w: 800, original_h: 600 }, { width: 800, height: 600 }],
    ['thumbnail dimensions', { thumb_360_w: 360, thumb_360_h: 270 }, { width: 360, height: 270 }],
    ['no dimensions', {}, {}],
    ['an invalid dimension', { original_w: 0, original_h: 600 }, {}],
  ] as const).map(([kind, dimensions, size]): Row => ({ name: `a file with ${kind}`, slack: diagram(dimensions), plain: 'See the diagram\ndiagram.png', block: { kind: 'file', id: 'F0DIAGRAM', name: 'diagram.png', mimetype: 'image/png', ...size } })),

  // Attachments: content ahead of the fallback summary.
  ...([
    ['GitHub-like', { title: '#42 Improve cache', text: 'Avoid duplicate requests', color: '36a64f' }, ['#42 Improve cache', 'Avoid duplicate requests']],
    ['Linear-like', { title: 'APP-12 Fix navigation', text: '*Ready* for review', title_link: 'https://example.test/issue/12' }, ['APP-12 Fix navigation', 'Ready for review']],
    ['alert-like', { title: 'Latency increased', fields: [{ title: 'Region', value: 'West' }, { title: 'Severity', value: 'Warning' }], footer: 'Monitor', ts: 1700000000, color: 'warning' }, ['Latency increased', 'Region', 'West', 'Monitor']],
  ] as const).map(([kind, attachment, shows]): Row => ({ name: `a ${kind} attachment`, slack: { attachments: [{ ...attachment, fallback: 'Event notification' }] }, like: { kind: 'attachment' }, shows, hides: ['Event notification'] })),
  { name: 'attachment text over a fallback', slack: { text: 'Status', attachments: [{ fallback: 'Build passed', text: 'Duplicate details' }] }, plain: 'Status\nDuplicate details' },
  { name: 'attachment title, text and fields', slack: { text: 'Status', attachments: [{ title: 'Build', text: 'Passed', fields: [{ title: 'Revision', value: 'abc' }] }] }, plain: 'Status\nBuild\nPassed\nRevision\nabc' },
  { name: 'a preview strips quotes inside an attachment', slack: { attachments: [{ text: '> Quoted detail\nVisible detail' }] }, preview: 'Visible detail' },
  { name: 'a pull request event is titled from its attachment', slack: { text: '[sample/project] Pull request opened', attachments: [{ title: '#42 Improve cache' }] }, title: 'PR #42: Improve cache' },
  { name: 'a human message is titled by its words, not the unfurl', slack: { text: 'This issue needs a careful review', attachments: [{ title: 'Unrelated page title' }] }, title: 'This issue needs a careful review' },
  {
    name: 'an unfurl keeps author, text, service icon and source link',
    slack: { attachments: [{
      title: 'Avery Example on X', from_url: 'https://example.test/post/1', author_name: 'Avery Example (@avery_example)', author_icon: 'https://example.test/author.png',
      text: 'Small experiments make the next decision clearer.', service_name: 'X', service_icon: 'https://example.test/x.png', image_url: 'https://example.test/chart.png', image_width: 600, image_height: 400,
    }] },
    like: {
      kind: 'attachment', author: { name: 'Avery Example (@avery_example)', icon: 'https://example.test/author.png' }, footerIcon: 'https://example.test/x.png', footer: [text('X')],
      title: [{ kind: 'link', url: 'https://example.test/post/1', text: 'Avery Example on X' }],
    },
    shows: ['Small experiments make the next decision clearer.'],
  },

  // A shared Slack message: its words once, wherever Slack put them.
  { name: 'a shared message as message blocks and text', slack: { text: '', attachments: [{ ...shared, message_blocks: [{ team: 'T0', channel: 'C0ENG', ts: shared.ts, message: { blocks: sharedWords } }] }] }, once: words, like: { kind: 'attachment', author: { name: 'Maya' } } },
  { name: 'a shared message as attachment blocks and text', slack: { attachments: [{ ...shared, blocks: sharedWords }] }, once: words },
  { name: 'a shared message as text only', slack: { attachments: [shared] }, once: words },
  {
    name: "a shared message of only a file shows the file, never Slack's fallback line",
    slack: { text: '', attachments: [{ ...wordless, is_share: true, fallback: '[October 19th, 2026 3:23 PM] Maya: demo.mov', files: [{ id: 'F0CLIP', name: 'demo.mov', mimetype: 'video/quicktime', original_w: 1280, original_h: 720 }] }] },
    like: { kind: 'attachment', blocks: [{ kind: 'file', id: 'F0CLIP', name: 'demo.mov', mimetype: 'video/quicktime', width: 1280, height: 720 }] }, hides: ['[October 19th, 2026 3:23 PM] Maya: demo.mov'],
  },
  // Where it came from: the place Juno knows, linked to the message; the footer is then only the date.
  { name: 'shared from a channel Juno knows', slack: sharedFrom(share), like: { source: { kind: 'public', name: 'eng', url: permalink, thread: false }, footer: [sharedDate] } },
  { name: 'shared from a thread reply', slack: sharedFrom({ ...share, from_url: `${permalink}?thread_ts=1792178000.000050&cid=C0ENG` }), like: { source: { name: 'eng', thread: true } } },
  { name: "shared from a thread's root, which is not a reply", slack: sharedFrom({ ...share, from_url: `${permalink}?thread_ts=1792178160.000100&cid=C0ENG` }), like: { source: { thread: false } } },
  { name: 'shared from a private channel, by channel_id', slack: sharedFrom({ ...share, channel_id: 'G0OPS', from_url: 'https://acme.slack.com/archives/G0OPS/p1792178160000100' }), like: { source: { kind: 'private', name: 'ops' } } },
  { name: 'shared from a DM, by channel_id', slack: sharedFrom({ ...share, channel_id: 'D0MAYA' }), like: { source: { kind: 'im', name: 'Maya Chen' } } },
  {
    name: "shared from a place Juno does not know keeps Slack's footer as a link",
    slack: sharedFrom({ ...share, channel_id: 'C0ELSEWHERE' }),
    like: { footer: [{ kind: 'link', url: permalink, text: 'Thread in Slack conversation' }, text(' · '), sharedDate] }, lacks: ['source'],
  },
  { name: 'shared from an unknown place with no footer is named by channel_name', slack: sharedFrom({ ...share, channel_id: 'C0ELSEWHERE', footer: '', channel_name: 'launch' }), like: { footer: [{ kind: 'link', url: permalink, text: '#launch' }, text(' · '), sharedDate] } },
  { name: 'another attachment with a permalink-like link is left as sent', slack: sharedFrom({ title: 'Planning notes', from_url: 'https://example.test/archives/C0ENG/p1792178160000100', footer: 'Docs' }), like: { footer: [text('Docs')] }, lacks: ['source'] },

  // Tables.
  {
    name: 'a table between words, cells as inlines, with column settings',
    slack: release,
    kinds: ['paragraph', 'table', 'paragraph'],
    block: {
      kind: 'table', rows: [
        [[text('Service')], [text('Owner')], [text('Notes')]],
        [[text('API')], [maya], [text('p95 at '), text('212 ms', { code: true })]],
        [[text('Worker', bold)], [], [{ kind: 'link', url: 'https://example.test/runbook', text: 'runbook' }, { kind: 'emoji', name: 'warning', unicode: '⚠️' }]],
      ],
      // An unknown alignment is dropped, so the column is left aligned; its wrap is kept.
      columns: [{}, { align: 'center' }, { wrap: true }],
    },
    // Copy, search and Ask Juno: a row per line, cells split by tabs, so a paste lands in a spreadsheet's cells.
    plain: 'Release status:\nService\tOwner\tNotes\nAPI\t@Maya Chen\tp95 at 212 ms\nWorker\t\trunbook⚠️\nRollback is ready.',
    // A message with words shows the words.
    preview: 'Release status: Rollback is ready.',
  },
  { name: 'a table of raw text and number cells', slack: tableOf([[{ type: 'raw_text', text: 'Region' }, { type: 'raw_number', text: '1,204' }]]), block: { kind: 'table', rows: [cells('Region', '1,204')] } },
  { name: 'a short row, filled with empty cells', slack: tableOf([[cell(t('a')), cell(t('b'))], [cell(t('c'))]]), block: { kind: 'table', rows: [cells('a', 'b'), [[text('c')], []]] } },
  { name: 'a cell kind Juno does not know, by its text', slack: tableOf([[{ type: 'action_cell', text: 'Open' }]]), block: { kind: 'table', rows: [cells('Open')] } },
  { name: 'two sections in one cell, one line each', slack: tableOf([[{ type: 'rich_text', elements: [section(t('one')), section(t('two'))] }]]), block: { kind: 'table', rows: [[[text('one'), { kind: 'break' }, text('two')]]] } },
  { name: 'a caption Slack does not show', slack: tableOf([[cell(t('a'))]], { caption: 'Deploys' }), block: { kind: 'table', rows: [cells('a')], caption: 'Deploys' } },
  { name: 'a caption Slack shows', slack: tableOf([[cell(t('a'))]], { caption: 'Deploys', is_caption_visible: true }), block: { kind: 'table', rows: [cells('a')], caption: 'Deploys', showCaption: true } },
  { name: 'a table with no rows falls back to the text', slack: tableOf([]), blocks: [para(text('Release status'))] },
  // A message that is only a table is previewed by its first row with words.
  { name: 'a table alone', slack: ownerTable, readable: 'Service\tOwner\nAPI\t@Maya Chen\nWorker\t', preview: 'Table: Service, Owner', line: ['Grafana', 'Grafana: Table: Service, Owner'], copied: [1, 3, 'API\t@Maya Chen\nWorker\t'] },
  { name: 'a table past an empty first row', slack: tableOf([[null, cell(t(' '))], [cell(t('API')), cell(t('ok'))]]), preview: 'Table: API, ok' },
  { name: 'a table with no words', slack: tableOf([[null, null]]), preview: 'Table' },
  // A tab, line feed or carriage return inside a cell becomes a space, so every cell stays in its column.
  { name: 'cells with CR and CRLF', slack: tableOf([[cell(t('one\rtwo')), cell(t('three\r\nfour'))]]), plain: 'one two\tthree four' },
  { name: 'a cell with a break and a tab', slack: tableOf([[{ type: 'rich_text', elements: [section(t('one\ttwo')), section(t('three'))] }, cell(t('x'))]]), plain: 'one two three\tx' },
  // Messages synced before tables were known were stored with the table as the schema's unknown variant.
  {
    name: 'a table cached as unknown reads as a table',
    stored: { text: 'Release status', blocks: [{ type: 'unknown', raw: { type: 'table', rows: [[cell(t('Service')), cell({ type: 'user', user_id: 'U0MAYA' })]], column_settings: [{ align: 'right' }] } }] },
    blocks: [{ kind: 'table', rows: [[[text('Service')], [maya]]], columns: [{ align: 'right' }] }], preview: 'Table: Service, @Maya Chen',
  },
  { name: 'a cached unknown that is not a readable table stays unknown', stored: { text: 'Release status', blocks: [{ type: 'unknown', raw: { type: 'table', rows: 'not rows' } }] }, blocks: [para(text('Release status'))] },
]

const decode = (payload: object): MessageContent => Schema.decodeUnknownSync(Message)({ ts: '1700000000.000000', ...payload })

describe('messages from Slack, as shown', () => {
  for (const row of rows) {
    it(row.name, () => {
      // A decoded Message is a MessageContent with no cast.
      const content: MessageContent = row.stored ?? decode(row.slack ?? {})
      const body = messageBody(content, row.lookups ?? lookups)
      const plain = plainText(body)
      if (row.blocks !== undefined) expect(body.blocks).toEqual([...row.blocks])
      if (row.kinds !== undefined) expect(body.blocks.map((block) => block.kind)).toEqual<ReadonlyArray<string>>(row.kinds)
      if (row.block !== undefined) expect(body.blocks.find((block) => block.kind === row.block!.kind)).toEqual(row.block)
      if (row.like !== undefined) expect(body.blocks[0]).toMatchObject(row.like)
      for (const field of row.lacks ?? []) expect(body.blocks[0]).not.toHaveProperty(field)
      for (const inline of row.has ?? []) expect(inlinesOf(body)).toContainEqual(inline)
      if (row.plain !== undefined) expect(plain).toBe(row.plain)
      if (row.readable !== undefined) expect(readableText(body)).toBe(row.readable)
      if (row.preview !== undefined) expect(previewText(body)).toBe(row.preview)
      if (row.line !== undefined) expect(previewLine(row.line[0], body)).toBe(row.line[1])
      for (const words of row.shows ?? []) {
        expect(plain).toContain(words)
        expect(previewText(body)).toContain(words)
      }
      for (const words of row.hides ?? []) expect(plain).not.toContain(words)
      if (row.once !== undefined) expect(plain.split(row.once)).toHaveLength(2)
      if (row.title !== undefined) expect(messageTitle(content)).toBe(row.title)
      if (row.copied !== undefined) {
        const table = body.blocks.find((block) => block.kind === 'table')
        expect(table?.kind === 'table' && tableText(table.rows.slice(row.copied[0], row.copied[1]))).toBe(row.copied[2])
      }
    })
  }
})
