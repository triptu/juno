/**
 * The `large` seed for the perf harness (docs/performance.md 7.3): 300
 * channels (180 public, 60 private, 40 DMs, 20 group DMs), 2 000 users,
 * about 5 000 threads, 100 000 messages spread over 30 days, 15 % with an
 * image attachment (dimensions included), 5 % with a code block, reactions
 * on 20 %, 10 % of topics unread. Deterministic for a seed number, generated
 * on demand in a few seconds, never checked in.
 *
 * ```ts
 * const fake = await startFakeSlack({ seed: largeSeed() })
 * ```
 */
import type { File, Ts, User } from '@juno/slack-schema'
import { SELF_ID, TEAM } from '../fixtures.ts'
import { NEVER_READ, type ConversationKind, type Workspace } from '../state.ts'

export interface LargeSeedOptions {
  readonly seed?: number
  readonly users?: number
  readonly channels?: { readonly public: number; readonly private: number; readonly dms: number; readonly mpims: number }
  readonly topics?: number
  readonly messages?: number
  readonly days?: number
}

export const LARGE_SEED_DEFAULTS = {
  seed: 1,
  users: 2_000,
  channels: { public: 180, private: 60, dms: 40, mpims: 20 },
  topics: 5_000,
  messages: 100_000,
  days: 30,
} as const

/** What the seed produced, for tests and the harness. */
export interface LargeSeedSummary {
  readonly users: number
  readonly conversations: number
  readonly threads: number
  readonly messages: number
}

/** mulberry32: small, fast, deterministic. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['Maya', 'Leo', 'Sam', 'Priya', 'Jonas', 'Elena', 'Dev', 'Ana', 'Tom', 'Yuki', 'Omar', 'Lena', 'Ravi', 'Nora', 'Max', 'Ida', 'Kai', 'Zoe', 'Ben', 'Mia']
const LAST = ['Chen', 'Park', 'Okafor', 'Raman', 'Weber', 'Ruiz', 'Patel', 'Silva', 'Novak', 'Sato', 'Haddad', 'Berg', 'Iyer', 'Lund', 'Keller', 'Moreau', 'Tanaka', 'Costa', 'Fischer', 'Rossi']
const WORDS = [
  'deploy', 'the', 'staging', 'bill', 'doubled', 'since', 'august', 'can', 'you', 'check', 'index', 'missing', 'after', 'last', 'night', 'rollout', 'queue',
  'depth', 'billing', 'consumer', 'retry', 'webhook', 'plan', 'draft', 'review', 'thursday', 'pair', 'on', 'it', 'looks', 'good', 'shipping', 'two-line',
  'default', 'flag', 'cleanup', 'script', 'terraform', 'lock', 'stuck', 'again', 'p95', 'jumped', 'hotfix', 'rolling', 'out', 'confirmed', 'back', 'thanks',
  'both', 'postmortem', 'doc', 'rush', 'agree', 'offline', 'mode', 'cut', 'partners', 'waiting', 'early', 'access', 'flow', 'notes', 'promo', 'packet',
]
const CHANNEL_WORDS = ['eng', 'product', 'platform', 'incidents', 'design', 'hiring', 'leadership', 'alerts', 'deploys', 'data', 'mobile', 'web', 'infra', 'sales', 'support', 'ops', 'growth', 'research', 'security', 'finance']
const EMOJI = ['+1', 'eyes', 'white_check_mark', 'tada', 'pray', 'heart', 'rocket']

/** Returns a seed function for `startFakeSlack({ seed })`. */
export function largeSeed(options: LargeSeedOptions = {}): (workspace: Workspace, avatarBase: string) => LargeSeedSummary {
  const config = { ...LARGE_SEED_DEFAULTS, ...options, channels: { ...LARGE_SEED_DEFAULTS.channels, ...options.channels } }
  return (workspace, avatarBase) => {
    const rand = random(config.seed)
    const pick = <T>(list: ReadonlyArray<T>): T => list[Math.floor(rand() * list.length)]!
    const now = workspace.clock.now()
    const DAY = 24 * 60 * 60 * 1000

    // Users. Self is the fixture user; everyone else is generated.
    const userIds: Array<string> = [SELF_ID]
    workspace.addUser(userObject(SELF_ID, 'tushar', 'Tushar', avatarBase, false))
    for (let i = 1; i < config.users; i++) {
      const id = `U${String(i).padStart(6, '0')}L`
      const bot = i % 50 === 0
      const name = bot ? `bot-${i}` : `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${i}`
      const real = bot ? `Bot ${i}` : `${pick(FIRST)} ${pick(LAST)}`
      workspace.addUser(userObject(id, name, real, avatarBase, bot))
      userIds.push(id)
    }
    const humans = userIds.filter((_, i) => i === 0 || i % 50 !== 0)

    // Conversations. Self is a member of every one so the sidebar shows them.
    const conversations: Array<{ id: string; kind: ConversationKind; members: Array<string> }> = []
    const addConversation = (id: string, kind: ConversationKind, name: string, members: Array<string>) => {
      workspace.addConversation({ id, name, kind, members: new Set(members), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
      conversations.push({ id, kind, members })
    }
    const memberSet = (count: number) => {
      const set = new Set<string>([SELF_ID])
      while (set.size < count) set.add(pick(humans))
      return [...set]
    }
    for (let i = 0; i < config.channels.public; i++) addConversation(`C${String(i).padStart(5, '0')}L`, 'public', `${pick(CHANNEL_WORDS)}-${i}`, memberSet(8 + Math.floor(rand() * 40)))
    for (let i = 0; i < config.channels.private; i++) addConversation(`G${String(i).padStart(5, '0')}L`, 'private', `${pick(CHANNEL_WORDS)}-private-${i}`, memberSet(3 + Math.floor(rand() * 10)))
    for (let i = 0; i < config.channels.dms; i++) addConversation(`D${String(i).padStart(5, '0')}L`, 'im', '', memberSet(2))
    for (let i = 0; i < config.channels.mpims; i++) {
      const members = memberSet(3 + Math.floor(rand() * 3))
      addConversation(`M${String(i).padStart(5, '0')}L`, 'mpim', `mpdm-${members.map((m) => m.toLowerCase()).join('--')}-1`, members)
    }

    // Messages: roots and replies, placed in time, posted oldest first.
    const sentence = (words: number) => Array.from({ length: words }, () => pick(WORDS)).join(' ')
    const text = (mention: boolean, code: boolean) => {
      let body = sentence(4 + Math.floor(rand() * 14))
      if (mention) body = `<@${SELF_ID}> ${body}`
      if (code) body = `${body}\n\`\`\`\nconst ${pick(WORDS)} = ${Math.floor(rand() * 1000)}\n\`\`\``
      return body
    }
    interface Planned {
      readonly channel: string
      readonly user: string
      readonly at: number
      readonly text: string
      readonly files?: ReadonlyArray<File>
      readonly root?: Planned
      readonly reactions: number
    }
    const planned: Array<Planned> = []
    const roots: Array<Planned> = []
    const threadCount = config.topics
    const repliesTotal = Math.max(0, config.messages - threadCount * 2)
    const plainMain = Math.max(0, config.messages - repliesTotal - threadCount)
    const conversationOf = () => pick(conversations)
    const senderIn = (c: { members: Array<string> }) => pick(c.members)
    const file = (index: number): File => {
      const w = 400 + Math.floor(rand() * 1200)
      const h = 300 + Math.floor(rand() * 900)
      const url = `${avatarBase}/../files/F${index}/image.png`
      return { id: `FL${index}`, name: 'image.png', title: 'image.png', mimetype: 'image/png', filetype: 'png', size: w * h, url_private: url, thumb_360: url, thumb_360_w: Math.min(360, w), thumb_360_h: Math.round((h * Math.min(360, w)) / w), original_w: w, original_h: h }
    }
    let fileIndex = 0
    const plan = (channel: { id: string; members: Array<string> }, root: Planned | undefined, at: number): Planned => {
      const withFile = rand() < 0.15
      const entry: Planned = {
        channel: channel.id,
        user: senderIn(channel),
        at,
        text: text(rand() < 0.04, rand() < 0.05),
        ...(withFile ? { files: [file(fileIndex++)] } : {}),
        ...(root === undefined ? {} : { root }),
        reactions: rand() < 0.2 ? 1 + Math.floor(rand() * 3) : 0,
      }
      planned.push(entry)
      return entry
    }
    for (let i = 0; i < threadCount; i++) {
      const c = conversationOf()
      roots.push(plan(c, undefined, Math.floor(now - rand() * config.days * DAY)))
    }
    for (let i = 0; i < plainMain; i++) {
      const c = conversationOf()
      plan(c, undefined, Math.floor(now - rand() * config.days * DAY))
    }
    for (let i = 0; i < repliesTotal; i++) {
      const root = pick(roots)
      const c = conversations.find((entry) => entry.id === root.channel)!
      plan(c, root, Math.floor(root.at + rand() * Math.min(3 * DAY, Math.max(60_000, now - root.at))))
    }
    planned.sort((a, b) => a.at - b.at)

    const tsOf = new Map<Planned, Ts>()
    let reactionIndex = 0
    for (const entry of planned) {
      const threadTs = entry.root === undefined ? undefined : tsOf.get(entry.root)
      const posted = workspace.post({
        channel: entry.channel,
        user: entry.user,
        text: entry.text,
        at: entry.at,
        ...(entry.files === undefined ? {} : { files: entry.files }),
        ...(threadTs === undefined ? {} : { threadTs }),
        silent: true,
      })
      tsOf.set(entry, posted.ts)
      for (let r = 0; r < entry.reactions; r++) {
        reactionIndex++
        silentReact(workspace, entry.channel, posted.ts, EMOJI[reactionIndex % EMOJI.length]!, pick(humans))
      }
    }

    // Subscriptions and read state: 10 % of topics unread; the user follows two thirds of the threads.
    let threads = 0
    for (const root of roots) {
      const ts = tsOf.get(root)!
      const replies = workspace.replies(root.channel, ts)
      if (replies.length === 0) continue
      threads++
      const unread = rand() < 0.1 ? 1 + Math.floor(rand() * Math.min(3, replies.length)) : 0
      const lastRead = unread === 0 ? replies.at(-1)!.ts : (replies.at(-1 - unread)?.ts ?? ts)
      workspace.subscriptions.set(`${root.channel}:${ts}`, { channel: root.channel, threadTs: ts, lastRead, subscribed: rand() < 0.66, dateCreate: root.at })
    }
    for (const c of conversations) {
      const main = workspace.main(c.id)
      const unread = rand() < 0.1 ? 1 + Math.floor(rand() * Math.min(5, main.length)) : 0
      const lastRead = unread === 0 ? (main.at(-1)?.ts ?? NEVER_READ) : (main.at(-1 - unread)?.ts ?? NEVER_READ)
      workspace.reads.set(c.id, lastRead)
    }

    return { users: userIds.length, conversations: conversations.length, threads, messages: planned.length }
  }
}

function userObject(id: string, name: string, realName: string, avatarBase: string, bot: boolean): User {
  const [first = name, ...rest] = realName.split(' ')
  const image = `${avatarBase}/${id}.svg`
  return {
    id,
    team_id: TEAM.id,
    name,
    real_name: realName,
    deleted: false,
    color: '2e1f64',
    tz: 'Europe/Paris',
    is_bot: bot,
    updated: 1_700_000_000,
    profile: {
      display_name: bot ? realName : first,
      real_name: realName,
      first_name: first,
      last_name: rest.join(' '),
      team: TEAM.id,
      avatar_hash: `fake${id.toLowerCase()}`,
      image_24: image,
      image_48: image,
      image_72: image,
    },
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
  else if (!existing.users?.includes(user)) {
    const users = [...(existing.users ?? []), user]
    reactions[reactions.indexOf(existing)] = { name, users, count: users.length }
  }
  list[index] = { ...message, reactions }
}
