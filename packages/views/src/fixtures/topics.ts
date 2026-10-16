/**
 * Sample sidebar rows for the gallery, shaped like `TopicRow` from the
 * contract and modelled on the fake Slack seed. Everything is invented.
 * Times are relative to `NOW` so the fixtures hold still.
 */
import type { Person, TopicRow } from '@juno/contract'

export const NOW = 1_760_000_000_000

/**
 * Topic art recipes in the vocabulary (`@juno/topic-art`), from the design
 * study's examples. A row without one shows the Tide placeholder, as a
 * topic does until its art is drawn.
 */
export const art = {
  database: '<svg viewBox="0 0 40 40" data-hue="teal">\n  <path d="M9 11 V29 A11 4.5 0 0 0 31 29 V11"/>\n  <path d="M9 20 A11 4.5 0 0 0 31 20" detail="1"/>\n  <ellipse cx="20" cy="11" rx="11" ry="4.5" fill="soft"/>\n  <circle cx="26" cy="29" r="2" fill="accent" stroke="none" detail="1"/>\n</svg>',
  calendar: '<svg viewBox="0 0 40 40" data-hue="periwinkle">\n  <rect x="7" y="10" width="26" height="23" rx="5" fill="soft"/>\n  <line x1="7" y1="17" x2="33" y2="17"/>\n  <line x1="13" y1="7" x2="13" y2="12"/>\n  <line x1="27" y1="7" x2="27" y2="12"/>\n  <circle cx="20" cy="25" r="2.2" fill="accent" stroke="none"/>\n</svg>',
  people: '<svg viewBox="0 0 40 40" data-hue="sage">\n  <circle cx="15" cy="13" r="5" fill="soft"/>\n  <path d="M6 33 C6 25 10 22 15 22 C20 22 24 25 24 33"/>\n  <circle cx="28" cy="15" r="4" fill="soft" detail="1"/>\n  <path d="M25 31 C26 26 27 24 28.5 24 C32 24 34 27 34 33" detail="1"/>\n</svg>',
  coins: '<svg viewBox="0 0 40 40" data-hue="amber">\n  <g>\n    <ellipse cx="18" cy="26" rx="11" ry="4.5" fill="soft"/>\n    <path d="M7 26 V21 A11 4.5 0 0 1 29 21 V26"/>\n    <path d="M7 21 A11 4.5 0 0 0 29 21"/>\n    <path d="M7 26 A11 4.5 0 0 0 29 26" detail="1"/>\n  </g>\n  <polyline points="22 15 27 10 33 13" stroke-width="2.5"/>\n  <circle cx="33" cy="13" r="2" fill="accent" stroke="none"/>\n</svg>',
  bell: '<svg viewBox="0 0 40 40" data-hue="coral">\n  <path d="M11 27 V19 A9 9 0 0 1 29 19 V27 L32 31 H8 Z" fill="soft"/>\n  <path d="M16 31 A4 4 0 0 0 24 31" detail="1"/>\n  <line x1="20" y1="6" x2="20" y2="10"/>\n  <circle cx="27" cy="12" r="2.2" fill="accent" stroke="none" detail="1"/>\n</svg>',
} as const

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const photo = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><circle cx="32" cy="26" r="12" fill="#F4E6D3"/><path d="M10 64c2-14 11-20 22-20s20 6 22 20Z" fill="#F4E6D3"/></svg>`,
  )}`

export const people = {
  maya: { id: 'U0MAYA', name: 'Maya Chen', color: 'claret', avatarUrl: photo('#8EB5C9') },
  leo: { id: 'U0LEO', name: 'Leo Park', color: 'midnight', avatarUrl: photo('#A7B8A0') },
  dev: { id: 'U0DEV', name: 'Dev Patel', color: 'cyan' },
  sam: { id: 'U0SAM', name: 'Sam Okafor', color: 'emeraldDark', avatarUrl: photo('#C9A98E') },
  priya: { id: 'U0PRIYA', name: 'Priya Raman', color: 'plum' },
  jonas: { id: 'U0JONAS', name: 'Jonas Weber', color: 'rose' },
  elena: { id: 'U0ELENA', name: 'Elena Ruiz', color: 'emerald' },
  grafana: { id: 'U0GRAFANA', name: 'Grafana', color: 'rose' },
  mohammed: { id: 'U0MOHAMMED', name: 'محمد', color: 'jordy' },
  unicorn: { id: 'U0UNICORN', name: '🦄 Unicorn', color: 'plum' },
  party: { id: 'U0PARTY', name: '🎉', color: 'emerald' },
} as const satisfies Record<string, Person>

type RowInput = Partial<Omit<TopicRow, 'preview' | 'channel'>> & {
  readonly id: string
  readonly title: string
  readonly sender: string
  readonly text: string
  readonly channel: TopicRow['channel']
  /** Minutes ago. */
  readonly ago: number
}

function row(input: RowInput): TopicRow {
  const { sender, text, ago, ...rest } = input
  const at = NOW - ago * MINUTE
  return {
    rev: 1,
    kind: 'thread',
    section: 'recent',
    status: 'open',
    titleSource: 'fallback',
    participants: [],
    messageCount: 1,
    unreadCount: 0,
    unreadExact: true,
    mentionsMe: false,
    tags: [],
    pinned: false,
    resolved: false,
    canResolveOnHover: true,
    subscribed: true,
    newThreads: 0,
    lastActivityTs: `${Math.floor(at / 1000)}.000100`,
    lastActivityAt: at,
    preview: { sender, text },
    ...rest,
  }
}

export const channels = {
  eng: { id: 'C0ENG', kind: 'public', name: 'eng', label: '#eng', tint: 'public', icon: 'wrench', color: 'cyan' },
  product: { id: 'C0PRODUCT', kind: 'public', name: 'product', label: '#product', tint: 'public', icon: 'rocket', color: 'plum' },
  alerts: { id: 'C0ALERTSPROD', kind: 'public', name: 'alerts-prod', label: '#alerts-prod', tint: 'public', icon: 'code', color: 'claret' },
  hiring: { id: 'C0HIRING', kind: 'private', name: 'hiring', label: '#hiring', tint: 'private', icon: 'shield', color: 'emeraldDark' },
  design: { id: 'C0DESIGNREV', kind: 'public', name: 'design-review', label: '#design-review', tint: 'public', icon: 'heart', color: 'rose' },
  maya: { id: 'D0MAYA', kind: 'im', name: 'Maya Chen', label: 'Maya Chen', tint: 'dm', icon: 'hash', color: 'claret', partner: people.maya },
  sam: { id: 'D0SAM', kind: 'im', name: 'Sam Okafor', label: 'Sam Okafor', tint: 'dm', icon: 'hash', color: 'emeraldDark', partner: people.sam },
  dev: { id: 'D0DEV', kind: 'im', name: 'Dev Patel', label: 'Dev Patel', tint: 'dm', icon: 'hash', color: 'cyan', partner: people.dev },
  group: { id: 'G0MAYALEO', kind: 'mpim', name: 'Maya, Leo', label: 'Maya, Leo', tint: 'dm', icon: 'hash', color: 'midnight', members: [people.maya, people.leo] },
  mohammed: { id: 'D0MOHAMMED', kind: 'im', name: 'محمد', label: 'محمد', tint: 'dm', icon: 'hash', color: 'jordy', partner: people.mohammed },
  unicorn: { id: 'D0UNICORN', kind: 'im', name: '🦄 Unicorn', label: '🦄 Unicorn', tint: 'dm', icon: 'hash', color: 'plum', partner: people.unicorn },
  emojiGroup: { id: 'G0EMOJI', kind: 'mpim', name: '🎉, 🦄 Unicorn, Ana', label: '🎉, 🦄 Unicorn, Ana', tint: 'dm', icon: 'hash', color: 'rose', members: [people.party, people.unicorn] },
  vendors: { id: 'C0VENDORS', kind: 'private', name: 'vendor-contracts-and-renewals', label: '#vendor-contracts-and-renewals', tint: 'private', icon: 'compass', color: 'midnight' },
} as const satisfies Record<string, TopicRow['channel']>

export const rows = {
  /** Read, two-line preview: no people, since nothing is unread. */
  postgres: row({
    id: 'C0ENG:1760000000.000100',
    title: 'Postgres 16 migration plan',
    sender: 'Dev',
    text: 'Booked 2–4pm. Will post results here.',
    channel: channels.eng,
    participants: [],
    messageCount: 7,
    art: art.database,
    ago: 4,
  }),
  /** Unread with a count: semibold title, subtle preview. */
  roadmap: row({
    id: 'C0PRODUCT:1760000000.000200',
    title: 'Q4 roadmap cuts',
    sender: 'Maya',
    text: "Draft is up. Cross-posting to #leadership once @Tushar has looked.",
    channel: channels.product,
    participants: [people.maya, people.priya],
    messageCount: 6,
    unreadCount: 3,
    ago: 25,
  }),
  /** A mention: the quiet @ tag before the count. */
  hiring: row({
    id: 'C0HIRING:1760000000.000300',
    title: 'Rina Sato · Staff backend',
    titleSource: 'ai',
    sender: 'Elena',
    text: '@Tushar she has a competing offer with a Friday deadline. Can you do a 30 min close call tomorrow?',
    channel: channels.hiring,
    participants: [people.elena, people.sam],
    messageCount: 3,
    unreadCount: 2,
    mentionsMe: true,
    art: art.people,
    ago: 12,
  }),
  /** A channel's Main: the channel label as the title, the Main tag, a 99+ count. */
  alertsMain: row({
    id: 'C0ALERTSPROD:main',
    kind: 'main',
    title: '#alerts-prod',
    titleSource: 'channel',
    sender: 'Grafana',
    text: '[RESOLVED] queue depth > 5k on billing-consumer',
    channel: channels.alerts,
    participants: [people.grafana],
    messageCount: 412,
    unreadCount: 128,
    tags: ['main'],
    art: art.bell,
    ago: 3,
  }),
  /** Back after a resolve. */
  pricing: row({
    id: 'C0PRODUCT:1759990000.000400',
    title: 'Final copy for pricing is in',
    sender: 'Priya',
    text: 'Legal flagged the annual discount line. Reopening this.',
    channel: channels.product,
    participants: [people.priya, people.maya],
    messageCount: 3,
    unreadCount: 1,
    tags: ['reopened'],
    ago: 4 * 60,
  }),
  /** Pinned, still open. */
  offsite: row({
    id: 'D0MAYA:1759990000.000500',
    section: 'pinned',
    title: 'Offsite: Wednesday afternoon slot',
    titleSource: 'manual',
    sender: 'Maya',
    text: 'Perfect. Send me a one-line description when you have it.',
    channel: channels.maya,
    participants: [],
    messageCount: 3,
    unreadCount: 1,
    pinned: true,
    art: art.calendar,
    ago: 38,
  }),
  /** Pinned and resolved: quieter, with a check, no Resolve on hover. */
  notes: row({
    id: 'D0SAM:1759900000.000600',
    section: 'pinned',
    status: 'resolved',
    title: '1:1 notes',
    titleSource: 'manual',
    sender: 'You',
    text: "Thanks. I'll review Dev's packet this week.",
    channel: channels.sam,
    participants: [],
    messageCount: 2,
    pinned: true,
    resolved: true,
    canResolveOnHover: false,
    ago: DAY / MINUTE + 60,
  }),
  /** A DM's Main: the tile is the person's photo, never art. */
  mayaMain: row({
    id: 'm:D0MAYA',
    kind: 'main',
    title: 'Maya Chen',
    titleSource: 'channel',
    sender: 'Maya',
    text: 'Sent you the deck. Tell me if the pricing slide reads.',
    channel: channels.maya,
    participants: [],
    messageCount: 9,
    tags: ['main'],
    ago: 16,
  }),
  /** A DM thread, read, no photo for the partner. */
  packet: row({
    id: 'D0DEV:1759980000.000700',
    title: 'Promo packet draft',
    titleSource: 'manual',
    sender: 'You',
    text: 'Looks good. Two comments inline.',
    channel: channels.dev,
    participants: [],
    messageCount: 5,
    ago: 2 * 60 + 10,
  }),
  /** A group DM Main. */
  lunch: row({
    id: 'G0MAYALEO:main',
    kind: 'main',
    title: 'Maya, Leo',
    titleSource: 'channel',
    sender: 'Leo',
    text: 'lunch friday?',
    channel: channels.group,
    participants: [],
    messageCount: 3,
    tags: ['main'],
    ago: 2 * DAY / MINUTE + 50,
  }),
  /** Unsubscribed but shown because it mentions you. */
  flags: row({
    id: 'C0PLATFORM:1759900000.000800',
    title: "We have 142 flags. 61 haven't…",
    sender: 'Jonas',
    text: '@Tushar ship it?',
    channel: { id: 'C0PLATFORM', kind: 'public', name: 'platform', label: '#platform', tint: 'public', icon: 'globe', color: 'jordy' },
    participants: [people.jonas, people.leo],
    messageCount: 3,
    unreadCount: 1,
    mentionsMe: true,
    tags: ['unsubscribed'],
    status: 'unsubscribed',
    subscribed: false,
    ago: 5 * 60,
  }),
  /** A long title and a long channel name, so the ellipses show. */
  long: row({
    id: 'C0DESIGNREV:1759900000.000900',
    title: 'Two options for the thread list: compact rows versus two-line previews, and what we lose with each one',
    sender: 'Priya',
    text: "That's where I landed too. Shipping two-line as the default, with the reply count kept because it tells you whether to open it now or later.",
    channel: { ...channels.design, name: 'design-review-and-critique-sessions' },
    participants: [],
    messageCount: 4,
    ago: 2 * 60 + 20,
  }),
  /** The latest message had no text (a file). */
  file: row({
    id: 'C0ENG:1759900000.001000',
    title: 'Replica sizing',
    titleSource: 'manual',
    sender: 'Dev',
    text: '',
    channel: channels.eng,
    participants: [],
    messageCount: 2,
    ago: 7 * 60,
  }),
  /** Right-to-left: an Arabic title, sender and message in a DM. */
  rtl: row({
    id: 'D0MOHAMMED:1759990000.001100',
    title: 'هل يمكننا مراجعة خطة الترحيل غدًا قبل الاجتماع الأسبوعي',
    sender: 'محمد',
    text: 'شكرًا جزيلًا، سأرسل الملاحظات بعد الظهر.',
    channel: channels.mohammed,
    participants: [],
    messageCount: 3,
    unreadCount: 1,
    ago: 50,
  }),
  /** A Latin sender before an Arabic message: each keeps its own direction. */
  mixed: row({
    id: 'C0ENG:1759990000.001200',
    title: 'Release notes in Arabic',
    titleSource: 'manual',
    sender: 'Leo',
    text: 'تم النشر على الخادم الجديد، والنتائج تبدو جيدة.',
    channel: channels.eng,
    participants: [],
    messageCount: 2,
    ago: 55,
  }),
  /** Names that start with an emoji: whole glyphs in every avatar, never half of one. */
  emoji: row({
    id: 'D0UNICORN:1759990000.001300',
    title: '🎉🎉🎉',
    sender: '🦄 Unicorn',
    text: '🎉🎉🎉',
    channel: channels.unicorn,
    participants: [],
    messageCount: 3,
    unreadCount: 1,
    ago: 70,
  }),
  /** A group DM of emoji names. */
  emojiGroup: row({
    id: 'G0EMOJI:main',
    kind: 'main',
    title: '🎉, 🦄 Unicorn, Ana',
    titleSource: 'channel',
    sender: '🎉',
    text: 'see you there',
    channel: channels.emojiGroup,
    participants: [],
    messageCount: 4,
    tags: ['main'],
    ago: 80,
  }),
  /** A private channel with a long name: the lock on line three, both texts cut off. */
  vendors: row({
    id: 'C0VENDORS:1759990000.001400',
    title: 'Private: the vendor contract renewal numbers for next year',
    sender: 'Sam',
    text: 'Numbers are in the sheet. Finance wants an answer by Thursday.',
    channel: channels.vendors,
    participants: [],
    messageCount: 2,
    ago: 95,
  }),
  /** The engine knows only a lower bound for the unread count. */
  lowerBound: row({
    id: 'C0ENG:main',
    kind: 'main',
    title: '#eng',
    titleSource: 'channel',
    sender: 'Dev',
    text: 'Replica lag back under a second.',
    channel: channels.eng,
    participants: [people.dev, people.leo, people.maya, people.sam],
    moreParticipants: 3,
    messageCount: 60,
    unreadCount: 60,
    unreadExact: false,
    tags: ['main'],
    ago: 6,
  }),
} as const satisfies Record<string, TopicRow>

/** Hostile content for the sidebar: right-to-left, emoji names, private, long and quiet rows. */
export const hostileIds: ReadonlyArray<string> = [
  rows.rtl.id,
  rows.mixed.id,
  rows.emoji.id,
  rows.emojiGroup.id,
  rows.vendors.id,
  rows.lowerBound.id,
  rows.notes.id,
  rows.flags.id,
]

/**
 * Threads started in a channel since its Main was last read, for the Main
 * rows' thread count. Not in the contract yet, so the gallery passes it to
 * `TopicRow` as `newThreads`. The group DM's Main has none.
 */
export const newThreadsById: ReadonlyMap<string, number> = new Map([
  [rows.alertsMain.id, 4],
  [rows.lowerBound.id, 12],
])

/** Every row above, keyed by id, as a container would hold them. */
export const rowsById: ReadonlyMap<string, TopicRow> = new Map(Object.values(rows).map((entry) => [entry.id, entry]))

/** The default sidebar: the pinned pair, then recent by latest activity. */
export const pinnedIds: ReadonlyArray<string> = [rows.offsite.id, rows.notes.id]
export const recentIds: ReadonlyArray<string> = [
  rows.alertsMain.id,
  rows.mayaMain.id,
  rows.postgres.id,
  rows.hiring.id,
  rows.roadmap.id,
  rows.packet.id,
  rows.long.id,
  rows.pricing.id,
  rows.flags.id,
  rows.file.id,
  rows.lunch.id,
]
