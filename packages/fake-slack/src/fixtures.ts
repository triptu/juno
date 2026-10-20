/**
 * The seed workspace, modelled on the prototype in
 * docs/design/handoff/prototype/Threads v3.dc.html. Everything is invented.
 * Times are minutes before the clock's "now" when the seed runs.
 */
import type { Team, Ts, User } from '@juno/slack-schema'
import { WORKSPACE_EMOJI } from './emoji.ts'
import { fileObject } from './files.ts'
import { samplePdf, samplePng } from './samples.ts'
import { NEVER_READ, Workspace, type ConversationKind } from './state.ts'

export const TEAM: Team = {
  id: 'T0JUNO',
  name: 'Juno Fake',
  domain: 'juno-fake',
  email_domain: 'juno-fake.test',
  prefs: {},
}

export interface SeedUser {
  readonly id: string
  readonly name: string
  readonly realName: string
  readonly title: string
  readonly color: string
  readonly tz: string
  readonly bot?: boolean
}

export const SELF_ID = 'U0TUSHAR'

export const PEOPLE: ReadonlyArray<SeedUser> = [
  { id: 'U0TUSHAR', name: 'tushar', realName: 'Tushar', title: 'Engineering manager', color: '008ab3', tz: 'Europe/Paris' },
  { id: 'U0MAYA', name: 'maya', realName: 'Maya Chen', title: 'Head of product', color: '7f1734', tz: 'America/Los_Angeles' },
  { id: 'U0LEO', name: 'leo', realName: 'Leo Park', title: 'Staff engineer', color: '2e1f64', tz: 'Europe/London' },
  { id: 'U0SAM', name: 'sam', realName: 'Sam Okafor', title: 'Engineering manager', color: '00674f', tz: 'Europe/Berlin' },
  { id: 'U0PRIYA', name: 'priya', realName: 'Priya Raman', title: 'Product designer', color: 'e89eb8', tz: 'Asia/Kolkata' },
  { id: 'U0JONAS', name: 'jonas', realName: 'Jonas Weber', title: 'SRE', color: 'a49496', tz: 'Europe/Berlin' },
  { id: 'U0ELENA', name: 'elena', realName: 'Elena Ruiz', title: 'Recruiter', color: '50c878', tz: 'Europe/Madrid' },
  { id: 'U0DEV', name: 'dev', realName: 'Dev Patel', title: 'Backend engineer', color: '92c2f9', tz: 'America/New_York' },
  { id: 'U0GRAFANA', name: 'grafana', realName: 'Grafana', title: '', color: 'a49496', tz: 'UTC', bot: true },
  { id: 'U0DEPLOYBOT', name: 'deploybot', realName: 'Deploy Bot', title: '', color: 'a49496', tz: 'UTC', bot: true },
]

const HUMANS = PEOPLE.filter((p) => p.bot !== true).map((p) => p.id)

export interface SeedConversation {
  readonly id: string
  readonly name: string
  readonly kind: ConversationKind
  readonly members: ReadonlyArray<string>
  readonly topic?: string
  readonly purpose?: string
  /** How many Main messages (from others) are unread. */
  readonly unread?: number
  readonly messages: ReadonlyArray<SeedMessage>
}

export interface SeedMessage {
  readonly from: string
  readonly text: string
  /** Minutes before now. */
  readonly ago: number
  readonly reactions?: ReadonlyArray<readonly [name: string, ...users: string[]]>
  readonly replies?: ReadonlyArray<SeedMessage>
  /** Files on the message. Their urls serve the bytes. */
  readonly files?: ReadonlyArray<SeedFile>
  /** Thread settings, on a root only. Default: subscribed, all read. */
  readonly thread?: { readonly subscribed?: boolean; readonly unread?: number }
}

export interface SeedFile {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly mimetype: string
  readonly bytes: () => Buffer
  readonly poster?: { readonly bytes: () => Buffer; readonly width: number; readonly height: number }
}

/** An image and a PDF in the product thread "Proposal: cut offline mode…", for attachment tests. */
/** User groups, mentioned as `<!subteam^S…>`. Self is in none; tests add them with `setSelfUsergroups`. One is deleted. */
export const USERGROUPS: ReadonlyArray<{ readonly id: string; readonly handle: string; readonly name: string; readonly deleted?: boolean }> = [
  { id: 'S0PLATFORM', handle: 'platform', name: 'Platform team' },
  { id: 'S0DESIGN', handle: 'design-crew', name: 'Design crew' },
  { id: 'S0OLDOPS', handle: 'old-ops', name: 'Old operations', deleted: true },
]

export const EARLY_ACCESS_PNG: SeedFile = {
  id: 'F0SEEDFLOW',
  name: 'early-access-flow.png',
  title: 'Early access flow',
  mimetype: 'image/png',
  bytes: () => samplePng(960, 640),
}

export const Q4_PLAN_PDF: SeedFile = {
  id: 'F0SEEDPLAN',
  name: 'q4-plan.pdf',
  title: 'Q4 plan',
  mimetype: 'application/pdf',
  bytes: () =>
    samplePdf('Q4 plan', [
      'One big bet: sync reliability.',
      'Cut: offline mode, public API v3.',
      'Design partners get an early access flow for v3.',
      'Review on Thursday.',
    ]),
}

const DEMO_VIDEO: SeedFile = {
  id: 'F0SEEDVIDEO', name: 'walkthrough.mp4', title: 'Walkthrough', mimetype: 'video/mp4',
  bytes: () => Buffer.from('invented video fixture'),
  poster: { bytes: () => samplePng(1280, 720), width: 1280, height: 720 },
}

const DEMO_SNIPPET: SeedFile = {
  id: 'F0SEEDNOTE', name: 'handoff.md', title: 'Handoff note', mimetype: 'text/markdown',
  bytes: () => Buffer.from('A short invented project note.\n'),
}

const DAY = 1440

export const CONVERSATIONS: ReadonlyArray<SeedConversation> = [
  {
    id: 'C0ENG',
    name: 'eng',
    kind: 'public',
    members: HUMANS,
    topic: 'Engineering',
    purpose: 'Everything engineering. Threads for anything longer than two messages.',
    unread: 2,
    messages: [
      // Main: on-call handoff
      { from: 'U0SAM', text: 'Reminder: on-call handoff moves to Mondays starting next week.', ago: 174 },
      { from: 'U0DEV', text: 'noted', ago: 171 },
      { from: 'U0JONAS', text: 'Does that include the weekend secondary?', ago: 156 },
      { from: 'U0SAM', text: 'Yes, both rotations move together.', ago: 154 },
      // Staging bill thread (root in Main)
      {
        from: 'U0LEO',
        text: 'Unrelated: has anyone looked at the staging bill? It doubled since August.',
        ago: 58,
        replies: [
          { from: 'U0JONAS', text: 'Preview environments have no TTL. I can add a 48h reaper.', ago: 54 },
          { from: 'U0LEO', text: 'Please do.', ago: 50 },
        ],
      },
      { from: 'U0DEV', text: '<@U0LEO> I think the preview environments never shut down. Will check.', ago: 55 },
      // Postgres 16 migration plan
      {
        from: 'U0LEO',
        text: 'Draft plan is in the doc. Short version: logical replication to the new cluster, cut over behind the read-only flag, about a 4 minute write freeze.',
        ago: 63,
        replies: [
          { from: 'U0DEV', text: '4 minutes is fine for us. Billing webhooks retry for 30 min, so nothing gets dropped.', ago: 55 },
          { from: 'U0TUSHAR', text: "Good. What's the rollback if replication lags on cutover day?", ago: 44 },
          { from: 'U0LEO', text: 'We keep the old primary warm for 48h. Flip DNS back and replay from the WAL position we logged.', ago: 31, reactions: [['+1', 'U0TUSHAR', 'U0DEV']] },
          { from: 'U0DEV', text: "> What's the rollback if replication lags on cutover day?\nI can own the dry run on staging Thursday.", ago: 13 },
          { from: 'U0LEO', text: "Thursday works. I'll pair. <@U0DEV> can you grab the replica sizing from <#C0PLATFORM|platform>?", ago: 10 },
          { from: 'U0DEV', text: 'Booked 2–4pm. Will post results here.', ago: 4 },
        ],
      },
      // Flaky checkout spec: active, not followed, and the last reply mentions self. Slack never told Juno
      // about it (no subscription), so at first sign-in it starts read and stays out of the sidebar.
      {
        from: 'U0DEV',
        text: 'checkout.spec failed again on main. Third time today.',
        ago: 229,
        thread: { subscribed: false, unread: 1 },
        replies: [
          { from: 'U0SAM', text: 'Quarantining it. Ticket filed.', ago: 221 },
          { from: 'U0DEV', text: 'Looks like a race in the payment iframe load.', ago: 200 },
          { from: 'U0SAM', text: 'Can you add a wait on the frame ready event?', ago: 191 },
          { from: 'U0DEV', text: 'On it.', ago: 190 },
          { from: 'U0SAM', text: '<@U0TUSHAR> can we live with the quarantine until Friday?', ago: 185 },
        ],
      },
      // Kafka consumer lag, old
      {
        from: 'U0JONAS',
        text: 'Lag alerts are firing on the billing consumer group every night at 2am.',
        ago: 8 * DAY + 20,
        replies: [{ from: 'U0DEV', text: 'Batch job. I will move it.', ago: 8 * DAY }],
      },
    ],
  },
  {
    id: 'C0PRODUCT',
    name: 'product',
    kind: 'public',
    members: HUMANS,
    topic: 'Product',
    purpose: 'Roadmap, specs and launches.',
    messages: [
      {
        from: 'U0MAYA',
        text: 'Proposal: cut offline mode and public API v3 from Q4. Keeps sync reliability as the one big bet.',
        ago: 110,
        thread: { unread: 3 },
        replies: [
          { from: 'U0PRIYA', text: 'Agree on offline. API v3 has two design partners waiting, though.', ago: 102 },
          { from: 'U0TUSHAR', text: "Eng view: cutting both frees about three engineers for sync. I'm for it.", ago: 75 },
          { from: 'U0MAYA', text: "Great. I'll write it up for Thursday's review.", ago: 64, reactions: [['pray', 'U0PRIYA']] },
          { from: 'U0PRIYA', text: "I'll mock an early access flow for the partners so v3 doesn't feel dropped.", ago: 57, files: [EARLY_ACCESS_PNG] },
          { from: 'U0MAYA', text: 'Draft is up. Cross-posting to <#C0LEADERSHIP|leadership> once <@U0TUSHAR> has looked.', ago: 25, files: [Q4_PLAN_PDF, DEMO_VIDEO, DEMO_SNIPPET] },
        ],
      },
      {
        from: 'U0PRIYA',
        text: 'Final copy for pricing is in. Any last edits?',
        ago: 3 * DAY + 180,
        thread: { unread: 1 },
        replies: [
          { from: 'U0MAYA', text: 'Ship it.', ago: 3 * DAY + 170 },
          { from: 'U0PRIYA', text: 'Legal flagged the annual discount line. Reopening this.', ago: 240 },
        ],
      },
    ],
  },
  {
    id: 'C0PLATFORM',
    name: 'platform',
    kind: 'public',
    members: HUMANS,
    topic: 'Platform and infra',
    messages: [
      // An active thread self never took part in: a topic, but not a sidebar row until self follows it.
      {
        from: 'U0JONAS',
        text: "We have 142 flags. 61 haven't changed in 90 days.",
        ago: 1730,
        thread: { subscribed: false },
        replies: [
          { from: 'U0LEO', text: "Let's delete anything fully rolled out. I'll script the PRs.", ago: 1715 },
          { from: 'U0JONAS', text: 'Ship it.', ago: 1700 },
        ],
      },
      {
        from: 'U0LEO',
        text: 'Terraform state lock is stuck again on the staging workspace.',
        ago: 10 * DAY + 10,
        replies: [{ from: 'U0JONAS', text: 'Force-unlocked.', ago: 10 * DAY }],
      },
    ],
  },
  {
    id: 'C0INCIDENTS',
    name: 'incidents',
    kind: 'public',
    members: HUMANS,
    topic: 'One thread per incident',
    messages: [
      {
        from: 'U0JONAS',
        text: 'p95 on /v2/search jumped to 1.8s. Looking.',
        ago: 95,
        replies: [
          { from: 'U0JONAS', text: "Cause: a missing index after last night's deploy. Hotfix rolling out.", ago: 84 },
          { from: 'U0DEV', text: 'Confirmed, p95 back to 210ms.', ago: 72, reactions: [['tada', 'U0JONAS', 'U0TUSHAR']] },
          { from: 'U0TUSHAR', text: 'Thanks both. Postmortem in the usual doc, no rush.', ago: 70, reactions: [['white_check_mark', 'U0JONAS']] },
        ],
      },
    ],
  },
  {
    id: 'C0DESIGNREV',
    name: 'design-review',
    kind: 'public',
    members: HUMANS,
    messages: [
      {
        from: 'U0PRIYA',
        text: 'Two options for the thread list: compact rows vs. two-line previews. Figma is linked in the channel.',
        ago: 160,
        replies: [
          { from: 'U0LEO', text: 'Two-line. Skimming beats fitting more rows on screen.', ago: 146 },
          { from: 'U0TUSHAR', text: 'Agree. And keep the reply count, it tells me whether to open it now or later.', ago: 139 },
          { from: 'U0PRIYA', text: "That's where I landed too. Shipping two-line as the default.", ago: 130, reactions: [['+1', 'U0LEO', 'U0TUSHAR']] },
        ],
      },
      {
        from: 'U0PRIYA',
        text: 'Icon refresh is merged.',
        ago: 14 * DAY + 10 * 60 + 10,
        replies: [{ from: 'U0LEO', text: 'Looks great.', ago: 14 * DAY + 10 * 60 }],
      },
    ],
  },
  {
    id: 'C0ALERTSPROD',
    name: 'alerts-prod',
    kind: 'public',
    members: [...HUMANS, 'U0GRAFANA'],
    topic: 'Production alerts from Grafana',
    unread: 9,
    messages: [
      { from: 'U0GRAFANA', text: '[FIRING] api p95 > 800ms (prod-eu)', ago: 145 },
      { from: 'U0GRAFANA', text: '[RESOLVED] api p95 > 800ms (prod-eu)', ago: 117 },
      { from: 'U0GRAFANA', text: '[FIRING] disk 80% on db-replica-2', ago: 92 },
      { from: 'U0GRAFANA', text: '[RESOLVED] disk 80% on db-replica-2', ago: 67 },
      { from: 'U0GRAFANA', text: '[FIRING] api p95 > 800ms (prod-eu)', ago: 49 },
      { from: 'U0GRAFANA', text: '[RESOLVED] api p95 > 800ms (prod-eu)', ago: 45 },
      { from: 'U0GRAFANA', text: '[FIRING] disk 85% on db-replica-2', ago: 32 },
      { from: 'U0GRAFANA', text: '[FIRING] queue depth > 5k on billing-consumer', ago: 6 },
      { from: 'U0GRAFANA', text: '[RESOLVED] queue depth > 5k on billing-consumer', ago: 3 },
    ],
  },
  {
    id: 'C0DEPLOYS',
    name: 'deploys',
    kind: 'public',
    members: [...HUMANS, 'U0DEPLOYBOT'],
    unread: 6,
    messages: [
      { from: 'U0DEPLOYBOT', text: 'web@c91d02 deployed to staging', ago: 161 },
      { from: 'U0DEPLOYBOT', text: 'web@c91d02 deployed to prod', ago: 116 },
      { from: 'U0DEPLOYBOT', text: 'api@7e55a1 deployed to staging', ago: 81 },
      { from: 'U0DEPLOYBOT', text: 'web@4f2a1c deployed to prod', ago: 59 },
      { from: 'U0DEPLOYBOT', text: 'api@91be07 deployed to staging', ago: 31 },
      { from: 'U0DEPLOYBOT', text: 'api@91be07 deployed to prod', ago: 9 },
    ],
  },
  // Public channels the self user is not a member of. The real `client.userBoot` lists them too;
  // they must never reach the sidebar, and no history is fetched for them.
  {
    id: 'C0SALES',
    name: 'sales',
    kind: 'public',
    members: ['U0MAYA', 'U0ELENA', 'U0SAM'],
    topic: 'Pipeline and deals',
    messages: [
      {
        from: 'U0ELENA',
        text: 'Q4 pipeline review is on Thursday. Bring your numbers.',
        ago: 48,
        replies: [{ from: 'U0MAYA', text: 'I will have the forecast ready.', ago: 35 }],
      },
      { from: 'U0SAM', text: 'Acme renewal is signed.', ago: 22 },
    ],
  },
  {
    id: 'C0SOCIAL',
    name: 'social',
    kind: 'public',
    members: ['U0PRIYA', 'U0LEO', 'U0DEV', 'U0JONAS'],
    messages: [
      {
        from: 'U0PRIYA',
        text: 'Board games at six?',
        ago: 205,
        replies: [
          { from: 'U0LEO', text: 'In.', ago: 198 },
          { from: 'U0DEV', text: 'Same.', ago: 180 },
        ],
      },
    ],
  },
  {
    id: 'C0HIRING',
    name: 'hiring',
    kind: 'private',
    members: ['U0TUSHAR', 'U0ELENA', 'U0SAM', 'U0MAYA'],
    topic: 'Open roles and candidates',
    messages: [
      {
        from: 'U0ELENA',
        text: 'Rina finished the onsite. Panel notes are in the scorecard.',
        ago: 37,
        thread: { unread: 2 },
        replies: [
          { from: 'U0SAM', text: 'Strong systems design. Went deep on idempotency without being prompted.', ago: 26 },
          { from: 'U0ELENA', text: '<@U0TUSHAR> she has a competing offer with a Friday deadline. Can you do a 30 min close call tomorrow?', ago: 12 },
        ],
      },
      {
        from: 'U0ELENA',
        text: "Marco's references came back. All positive, one note on delegation.",
        ago: 1520,
        replies: [{ from: 'U0TUSHAR', text: "Let's talk through that note at sync. Otherwise moving forward.", ago: 1500 }],
      },
    ],
  },
  {
    id: 'C0LEADERSHIP',
    name: 'leadership',
    kind: 'private',
    members: ['U0TUSHAR', 'U0MAYA', 'U0SAM'],
    // No message in Main for 9 days, but a followed thread with replies this week: the thread is a
    // sidebar row, and the channel's Main stays visible because of it.
    messages: [
      {
        from: 'U0MAYA',
        text: 'Finance wants the 2027 plan by the 20th.',
        ago: 9 * DAY + 30,
        thread: { unread: 1 },
        replies: [
          { from: 'U0SAM', text: 'Eng ask is six: four backend, one SRE, one EM.', ago: 9 * DAY + 15 },
          { from: 'U0MAYA', text: '<@U0TUSHAR> can you own the narrative for the SRE role?', ago: 2 * DAY },
        ],
      },
      { from: 'U0MAYA', text: 'Retro notes are in the doc.', ago: 18 * DAY + 80 },
    ],
  },
  {
    id: 'D0MAYA',
    name: '',
    kind: 'im',
    members: ['U0TUSHAR', 'U0MAYA'],
    messages: [
      { from: 'U0MAYA', text: 'Running 5 late to the planning sync', ago: 2005 },
      { from: 'U0TUSHAR', text: 'no worries', ago: 2000 },
      {
        from: 'U0MAYA',
        text: 'Can eng take the Wednesday afternoon slot at the offsite? 90 minutes.',
        ago: 103,
        thread: { unread: 1 },
        replies: [
          { from: 'U0TUSHAR', text: 'Yes. Thinking a roadmap teardown, not slides.', ago: 90 },
          { from: 'U0MAYA', text: 'Perfect. Send me a one-line description when you have it.', ago: 38 },
        ],
      },
    ],
  },
  {
    id: 'D0SAM',
    name: '',
    kind: 'im',
    members: ['U0TUSHAR', 'U0SAM'],
    messages: [
      {
        from: 'U0SAM',
        text: 'Notes from today: promo packet for Dev, on-call load, Q1 planning.',
        ago: 1810,
        replies: [{ from: 'U0TUSHAR', text: "Thanks. I'll review Dev's packet this week.", ago: 1800 }],
      },
    ],
  },
  {
    id: 'G0MAYALEO',
    name: 'mpdm-tushar--maya--leo-1',
    kind: 'mpim',
    members: ['U0TUSHAR', 'U0MAYA', 'U0LEO'],
    messages: [
      { from: 'U0LEO', text: 'lunch friday?', ago: 3110 },
      { from: 'U0MAYA', text: 'yes. the ramen place', ago: 3105 },
      { from: 'U0TUSHAR', text: 'in', ago: 3100 },
    ],
  },
]

function userObject(seed: SeedUser, avatarBase: string): User {
  const [first, ...rest] = seed.realName.split(' ')
  const image = `${avatarBase}/${seed.id}.svg`
  return {
    id: seed.id,
    team_id: TEAM.id,
    name: seed.name,
    real_name: seed.realName,
    deleted: false,
    color: seed.color,
    tz: seed.tz,
    tz_label: seed.tz,
    tz_offset: 0,
    is_admin: seed.id === SELF_ID,
    is_owner: false,
    is_bot: seed.bot === true,
    is_app_user: false,
    is_restricted: false,
    is_ultra_restricted: false,
    updated: 1_700_000_000,
    profile: {
      display_name: seed.bot === true ? seed.realName : (first ?? seed.name),
      display_name_normalized: seed.bot === true ? seed.realName : (first ?? seed.name),
      real_name: seed.realName,
      real_name_normalized: seed.realName,
      first_name: first ?? seed.name,
      last_name: rest.join(' '),
      title: seed.title,
      team: TEAM.id,
      avatar_hash: `fake${seed.id.toLowerCase()}`,
      // Leo keeps Slack's default photo: live, `is_custom_image` is then absent, not false.
      ...(seed.bot === true || seed.id === 'U0LEO' ? {} : { is_custom_image: true, image_original: `${image}?size=original` }),
      image_24: image,
      image_32: image,
      image_48: `${image}?size=48`,
      image_72: `${image}?size=72`,
      image_192: `${image}?size=192`,
      image_512: image,
      status_text: '',
      status_emoji: '',
      ...(seed.bot === true ? { bot_id: `B${seed.id.slice(1)}`, always_active: true } : {}),
    },
  }
}

/** Fills a workspace with the seed. `avatarBase` is the URL under which the fake serves avatars. */
export function seedWorkspace(workspace: Workspace, avatarBase: string): void {
  const now = workspace.clock.now()
  const minute = 60_000
  const at = (ago: number) => now - ago * minute
  // Avatars are served at `<base>/avatars`, files at `<base>/files`.
  const emojiBase = avatarBase.replace(/\/avatars$/, '/emoji')
  for (const name of Object.keys(WORKSPACE_EMOJI)) workspace.emoji.set(name, { name, value: `${emojiBase}/${name}.svg` })
  workspace.emoji.set('hello_juno', { name: 'hello_juno', value: 'alias:juno_wave' })
  const baseUrl = avatarBase.replace(/\/avatars$/, '')

  for (const person of PEOPLE) workspace.addUser(userObject(person, avatarBase))
  for (const group of USERGROUPS) workspace.putUsergroup(group, false)

  workspace.prefs = {
    muted_channels: 'C0DEPLOYS',
    highlight_words: 'postgres,offsite',
    mute_sounds: false,
    show_typing: true,
    enable_unread_view: true,
    enable_threads_view: true,
    tz: 'Europe/Paris',
    time24: true,
    locale: 'en-US',
    all_channels_loud: false,
    channel_notification_settings: '{}',
    desktop_notification_actions: 'default',
    emoji_mode: 'default',
    // Slack's notification schedule, the same as Juno's default notification hours (Monday to Friday, 9 to 7). Hours come in both forms live.
    dnd_enabled: true,
    dnd_days: 'weekdays',
    dnd_start_hour: '19:00',
    dnd_end_hour: '9:00',
  }

  for (const seed of CONVERSATIONS) {
    workspace.addConversation({
      id: seed.id,
      name: seed.name,
      kind: seed.kind,
      members: new Set(seed.members),
      created: at(90 * DAY),
      topic: seed.topic ?? '',
      purpose: seed.purpose ?? '',
      isOpen: true,
      archived: false,
    })
  }

  // Messages, oldest first across the whole workspace so ts order matches time order.
  const roots: Array<{ channel: string; seed: SeedMessage; ts: Ts }> = []
  const flat: Array<{ channel: string; seed: SeedMessage; parent?: SeedMessage }> = []
  for (const conversation of CONVERSATIONS) {
    for (const message of conversation.messages) {
      flat.push({ channel: conversation.id, seed: message })
      for (const reply of message.replies ?? []) flat.push({ channel: conversation.id, seed: reply, parent: message })
    }
  }
  flat.sort((a, b) => b.seed.ago - a.seed.ago)
  const tsOf = new Map<SeedMessage, Ts>()
  for (const entry of flat) {
    const parentTs = entry.parent === undefined ? undefined : tsOf.get(entry.parent)
    const files = entry.seed.files?.map((file) => {
      const bytes = file.bytes()
      const stored = { id: file.id, name: file.name, title: file.title, length: bytes.length, user: entry.seed.from, created: at(entry.seed.ago), bytes, mimetype: file.mimetype, ...(file.poster === undefined ? {} : { poster: { ...file.poster, bytes: file.poster.bytes() } }) }
      workspace.files.set(file.id, stored)
      return fileObject(baseUrl, stored, workspace.conversation(entry.channel)?.kind === 'public')
    })
    const posted = workspace.post({
      channel: entry.channel,
      user: entry.seed.from,
      text: entry.seed.text,
      at: at(entry.seed.ago),
      ...(files === undefined ? {} : { files }),
      ...(parentTs === undefined ? {} : { threadTs: parentTs }),
      silent: true,
    })
    tsOf.set(entry.seed, posted.ts)
    for (const [name, ...users] of entry.seed.reactions ?? []) {
      for (const user of users) silentReact(workspace, entry.channel, posted.ts, name, user)
    }
    if (entry.parent === undefined && entry.seed.replies !== undefined) roots.push({ channel: entry.channel, seed: entry.seed, ts: posted.ts })
  }

  // Thread subscriptions and read state. Self follows every thread by default, in the channels self is in.
  for (const root of roots) {
    if (!workspace.isMember(root.channel)) continue
    const replies = workspace.replies(root.channel, root.ts)
    const settings = root.seed.thread ?? {}
    const unread = settings.unread ?? 0
    const lastRead = unread === 0 ? (replies.at(-1)?.ts ?? root.ts) : (replies.at(-1 - unread)?.ts ?? root.ts)
    workspace.subscriptions.set(`${root.channel}:${root.ts}`, {
      channel: root.channel,
      threadTs: root.ts,
      lastRead,
      subscribed: settings.subscribed ?? true,
      dateCreate: at(root.seed.ago),
    })
  }
  for (const conversation of CONVERSATIONS) {
    const main = workspace.main(conversation.id)
    const unread = conversation.unread ?? 0
    const lastRead = unread === 0 ? (main.at(-1)?.ts ?? NEVER_READ) : (main.at(-1 - unread)?.ts ?? NEVER_READ)
    workspace.reads.set(conversation.id, lastRead)
  }
}

function silentReact(workspace: Workspace, channel: string, ts: string, name: string, user: string): void {
  const list = workspace.all(channel)
  const index = list.findIndex((m) => m.ts === ts)
  const message = list[index]
  if (message === undefined) return
  const reactions = [...(message.reactions ?? [])]
  const existing = reactions.find((r) => r.name === name)
  if (existing === undefined) reactions.push({ name, users: [user], count: 1 })
  else {
    const users = [...(existing.users ?? []), user]
    reactions[reactions.indexOf(existing)] = { name, users, count: users.length }
  }
  list[index] = { ...message, reactions }
}
