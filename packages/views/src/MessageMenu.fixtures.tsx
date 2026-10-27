import { emojiCatalog, prepareEmojiPicker } from '@juno/contract'
import { defineFixtures, scene, type FixtureFrame, type MenuPoint } from '@juno/ui'
import { NOW } from './fixtures/topics'
import { thread } from './fixtures/messages'
import { MessageList } from './MessageList'
import { MessageMenu, type MessageMenuProps } from './MessageMenu'
import type { GridReaction, MessageMenuEntry } from './messageMenuModel'

const noop = () => {}

/** A custom emoji as a small SVG, so the fixture needs no server. */
const shipIt = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="m4 22 11-3 3-14q10-4 12-3 1 9-4 16L14 22l-6 7Z" fill="#7b8de0"/><path d="m12 23-6 2-3 7 8-4Z" fill="#ed9752"/><circle cx="24" cy="9" r="3" fill="#d4f3ff"/></svg>')}`

/** The default quick reactions, then frequently used and common emoji: eleven, as the menu fills them. */
const grid = (selected: ReadonlyArray<string> = []): ReadonlyArray<GridReaction> =>
  [
    { name: '+1', unicode: '👍' },
    { name: 'white_check_mark', unicode: '✅' },
    { name: 'eyes', unicode: '👀' },
    { name: 'tada', unicode: '🎉' },
    { name: 'pray', unicode: '🙏' },
    { name: 'heart', unicode: '❤️' },
    { name: 'joy', unicode: '😂' },
    { name: 'fire', unicode: '🔥' },
    { name: '100', unicode: '💯' },
    { name: 'raised_hands', unicode: '🙌' },
    { name: 'slightly_smiling_face', unicode: '🙂' },
  ].map((emoji) => ({ ...emoji, selected: selected.includes(emoji.name) }))

const withCustom: ReadonlyArray<GridReaction> = [{ name: 'ship-it', unicode: ':ship-it:', url: shipIt, selected: false }, ...grid().slice(0, 10)]

const S: MessageMenuEntry = { separator: true }
/** Copy Slack link, at the end of Open in Slack. */
const copyLink = { id: 'copy-link', label: 'Copy Slack link', icon: 'link' } as const
/** Forward…, Mark unread and Open in Slack, after Copy, on every message Slack has. */
const shared: ReadonlyArray<MessageMenuEntry> = [
  { id: 'forward', label: 'Forward…', icon: 'forward', shortcut: 'F' },
  { id: 'mark-unread', label: 'Mark unread', icon: 'unread', shortcut: 'U' },
  { id: 'open-in-slack', label: 'Open in Slack', icon: 'slack', trailing: copyLink },
]
/** Someone else's message in a thread. */
const others: ReadonlyArray<MessageMenuEntry> = [
  { id: 'quote', label: 'Quote', icon: 'quote', shortcut: 'Q' },
  { id: 'ask-juno', label: 'Ask Juno', icon: 'juno' },
  S,
  { id: 'copy', label: 'Copy text', icon: 'copy' },
  ...shared,
]
/** Someone else's message in Main, with text selected in it. */
const mainSelection: ReadonlyArray<MessageMenuEntry> = [
  { id: 'reply', label: 'Start thread', icon: 'thread', shortcut: 'T' },
  { id: 'quote', label: 'Quote', icon: 'quote', shortcut: 'Q' },
  { id: 'ask-juno', label: 'Ask Juno', icon: 'juno' },
  S,
  { id: 'copy', label: 'Copy', icon: 'copy' },
  ...shared,
]
/** Your own reply in a thread. */
const own: ReadonlyArray<MessageMenuEntry> = [
  { id: 'quote', label: 'Quote', icon: 'quote', shortcut: 'Q' },
  { id: 'ask-juno', label: 'Ask Juno', icon: 'juno' },
  S,
  { id: 'copy', label: 'Copy text', icon: 'copy' },
  ...shared,
  S,
  { id: 'broadcast', label: 'Also send to #eng', icon: 'broadcast' },
  { id: 'watch-reply', label: 'Tell me if nobody replies', icon: 'bell' },
  S,
  { id: 'edit', label: 'Edit', icon: 'edit', shortcut: 'E' },
  { id: 'delete', label: 'Delete…', icon: 'delete', shortcut: '⌫' },
]
/** Your own message in Main. */
const ownMain: ReadonlyArray<MessageMenuEntry> = [
  { id: 'reply', label: 'Open thread', icon: 'thread', shortcut: 'T' },
  { id: 'quote', label: 'Quote', icon: 'quote', shortcut: 'Q' },
  { id: 'ask-juno', label: 'Ask Juno', icon: 'juno' },
  S,
  { id: 'copy', label: 'Copy text', icon: 'copy' },
  ...shared,
  S,
  { id: 'watch-reply', label: 'Tell me if nobody replies', icon: 'bell', disabled: true },
  S,
  { id: 'edit', label: 'Edit', icon: 'edit', shortcut: 'E' },
  { id: 'delete', label: 'Delete…', icon: 'delete', shortcut: '⌫' },
]
/** Your own message still sending: Slack has no link for it yet. */
const pending: ReadonlyArray<MessageMenuEntry> = [
  { id: 'quote', label: 'Quote', icon: 'quote', shortcut: 'Q' },
  S,
  { id: 'copy', label: 'Copy text', icon: 'copy' },
  { id: 'forward', label: 'Forward…', icon: 'forward', shortcut: 'F', disabled: true },
  { id: 'mark-unread', label: 'Mark unread', icon: 'unread', shortcut: 'U', disabled: true },
  { id: 'open-in-slack', label: 'Open in Slack', icon: 'slack' },
  S,
  { id: 'edit', label: 'Edit', icon: 'edit', shortcut: 'E' },
  { id: 'delete', label: 'Delete…', icon: 'delete', shortcut: '⌫' },
]
/** A Juno bubble or card. */
const junoBubble: ReadonlyArray<MessageMenuEntry> = [
  { id: 'reply', label: 'Reply', icon: 'reply' },
  { id: 'copy', label: 'Copy', icon: 'copy' },
  S,
  { id: 'remove', label: 'Remove…', icon: 'delete' },
]
/** Your own bubble in the Juno chat, before the agent has said it can be removed. */
const junoOwn: ReadonlyArray<MessageMenuEntry> = [
  { id: 'copy', label: 'Copy', icon: 'copy' },
  { id: 'remember', label: 'Remember this', icon: 'pin' },
  S,
  { id: 'remove', label: 'Remove…', icon: 'delete', disabled: true },
]

const emoji = { data: prepareEmojiPicker(emojiCatalog, []), recent: ['+1', 'white_check_mark', 'eyes', 'tada', 'rocket'] }

/** The window the menu opens in: a topic's messages behind it, so its translucent material shows what it sits on. */
const WIDTH = 900
const HEIGHT = 640

type Anchor = MenuPoint | ((view: { readonly width: number; readonly height: number }) => MenuPoint)

const menu = (props: Partial<MessageMenuProps>, anchor: Anchor = { x: 360, y: 120 }, frame: FixtureFrame = {}, behind = true) =>
  scene<MessageMenuProps>(
    () => (
      <>
        {behind ? <MessageList items={thread} main={false} now={NOW} underHeader={false} /> : null}
        <MessageMenu
          anchor={typeof anchor === 'function' ? anchor({ width: frame.width ?? WIDTH, height: frame.height ?? HEIGHT }) : anchor}
          reactions={grid()}
          items={others}
          onReact={noop}
          emoji={emoji}
          onSelect={noop}
          onClose={noop}
          inline
          {...props}
        />
      </>
    ),
    { width: WIDTH, height: HEIGHT, padded: false, ...frame },
  )

// Pointers near each corner of the window, 40px in.
const topLeft: Anchor = { x: 40, y: 40 }
const topRight: Anchor = ({ width }) => ({ x: width - 40, y: 40 })
const bottomLeft: Anchor = ({ height }) => ({ x: 40, y: height - 40 })
const bottomRight: Anchor = ({ width, height }) => ({ x: width - 40, y: height - 40 })

export default defineFixtures(MessageMenu, {
  // A right-click on a message: the emoji grid, then the rows in groups.
  Look: {
    others: menu({}),
    'main-selection': menu({ items: mainSelection, reactions: grid(['+1']) }),
    own: menu({ items: own }),
    // Your own in Main: Open thread, Edit and Delete… show their keys at the row's end.
    'own-main': menu({ items: ownMain }),
    // Still sending: Open in Slack has no Copy Slack link at its end.
    pending: menu({ items: pending }),
    // Emoji you already reacted with show chosen; choosing one again takes it back.
    reacted: menu({ reactions: grid(['+1', 'eyes']) }),
    // A quick reaction can be a workspace's custom emoji.
    'custom-emoji': menu({ reactions: withCustom }),
    // On the page alone, for measuring what it paints.
    bare: menu({}, { x: 40, y: 40 }, { width: 320, height: 360 }, false),
  },
  // A Juno bubble or card, and your own bubble in the Juno chat, which takes no reaction.
  Juno: {
    bubble: menu({ items: junoBubble }),
    own: menu({ items: junoOwn, noGrid: true }),
  },
  // Downward from the pointer, never above it; to its left near the right edge, where the picker would not fit.
  Placement: {
    'top-left': menu({}, topLeft),
    'top-right': menu({}, topRight),
    'bottom-left': menu({}, bottomLeft),
    'bottom-right': menu({}, bottomRight),
  },
  // More reactions: the menu has become the full emoji picker, grown from one corner of the menu that stayed put.
  'More reactions': {
    'top-left': menu({ initialPicking: true }, topLeft),
    'top-right': menu({ initialPicking: true }, topRight),
    'bottom-left': menu({ initialPicking: true }, bottomLeft),
    'bottom-right': menu({ initialPicking: true }, bottomRight),
    search: menu({ initialPicking: true, initialQuery: 'party' }, topLeft),
    // A window too short for the picker above or below the menu: it is held inside, 6px from the edges.
    'short-window': menu({ initialPicking: true }, { x: 40, y: 120 }, { height: 340 }),
  },
  Interaction: {
    'hover-row': menu({}, undefined, { hover: '[data-menu-item="forward"]' }),
    // A highlighted row's key takes the highlight's text colour.
    'hover-shortcut': menu({ items: ownMain }, undefined, { hover: '[data-menu-item="edit"]' }),
    'hover-cell': menu({ reactions: grid(['eyes']) }, undefined, { hover: '[data-grid-reaction="eyes"]' }),
    'hover-more': menu({}, undefined, { hover: '[data-grid-more]' }),
    // Open in Slack with Copy Slack link at its end: the whole row highlights, and the link button has its own fill
    // when the pointer is on it or the → key reached it.
    'hover-open-in-slack': menu({}, undefined, { hover: '[data-menu-item="open-in-slack"]' }),
    'hover-copy-link': menu({}, undefined, { hover: '[data-menu-trailing="copy-link"]' }),
    'focus-copy-link': menu({}, undefined, { focus: '[data-menu-trailing="copy-link"]' }),
  },
})
