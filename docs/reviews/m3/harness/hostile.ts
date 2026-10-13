/**
 * A hostile seed for the break pass: the default workspace plus channels,
 * people and threads with the shapes the sidebar must survive. Every string
 * is invented.
 */
import type { User } from '@juno/slack-schema'
import { seedWorkspace, SELF_ID, TEAM } from '../../../../packages/fake-slack/src/fixtures.ts'
import type { Workspace } from '../../../../packages/fake-slack/src/state.ts'

const MINUTE = 60_000
const DAY = 1440 * MINUTE

export const LONG_CHANNEL = 'a-very-long-channel-name-that-goes-on-and-on-without-any-break-at-all-until-it-is-far-wider-than-the-sidebar'
export const CJK_CHANNEL = '日本語のチャンネル名'
export const UNBROKEN = 'Loremipsumdolorsitametconsecteturadipiscingelitseddoeiusmodtemporincididuntutlaboreetdoloremagnaaliquaenimadminimveniamquisnostrudexercitation'
export const LONG_URL = 'https://example.com/a/very/long/path/that/keeps/going/for/a/while?query=parameter&another=value&yet=another&one=more&still=going&and=going'
export const ARABIC = 'هل يمكننا مراجعة خطة الترحيل غدًا صباحًا قبل الاجتماع الأسبوعي'
export const CJK = '移行計画のレビューを明日の朝、週次ミーティングの前に行えますか'
export const EMOJI_ONLY = '🎉🎉🎉'
export const LONG_PERSON = 'Maximilian Alexander von Hohenzollern-Sigmaringen the Third'
export const EMOJI_PERSON = '🦄 Unicorn'

function user(id: string, name: string, realName: string): User {
  const [first, ...rest] = realName.split(' ')
  return {
    id,
    team_id: TEAM.id,
    name,
    real_name: realName,
    deleted: false,
    color: '9f69e7',
    tz: 'Europe/Paris',
    tz_label: 'Europe/Paris',
    tz_offset: 0,
    is_admin: false,
    is_owner: false,
    is_bot: false,
    is_app_user: false,
    is_restricted: false,
    is_ultra_restricted: false,
    updated: 1_700_000_000,
    profile: {
      display_name: first ?? name,
      display_name_normalized: first ?? name,
      real_name: realName,
      real_name_normalized: realName,
      first_name: first ?? name,
      last_name: rest.join(' '),
      title: '',
      team: TEAM.id,
      avatar_hash: `fake${id.toLowerCase()}`,
      status_text: '',
      status_emoji: '',
    },
  }
}

export function hostileSeed(workspace: Workspace, avatarBase: string): void {
  seedWorkspace(workspace, avatarBase)
  const now = workspace.clock.now()
  const at = (minutesAgo: number) => now - minutesAgo * MINUTE

  const people = [
    user('U1LONG', 'maximilian', LONG_PERSON),
    user('U1ARAB', 'mohammed', 'محمد عبد الرحمن'),
    user('U1CJK', 'yamada', '山田 太郎'),
    user('U1EMOJI', 'unicorn', EMOJI_PERSON),
  ]
  for (const person of people) workspace.addUser(person)
  const crowd: string[] = []
  for (let i = 0; i < 30; i++) {
    const id = `U1CROWD${i}`
    workspace.addUser(user(id, `person${i}`, `Person ${i} Crowd`))
    crowd.push(id)
  }

  const channel = (id: string, name: string, kind: 'public' | 'private' | 'im' | 'mpim', members: string[]) =>
    workspace.addConversation({ id, name, kind, members: new Set([SELF_ID, ...members]), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })

  channel('C1LONG', LONG_CHANNEL, 'public', ['U1LONG', 'U0LEO', ...crowd])
  channel('C1CJK', CJK_CHANNEL, 'public', ['U1CJK', 'U0MAYA'])
  channel('C1PRIV', 'private-ops', 'private', ['U0SAM'])
  channel('D1ARAB', '', 'im', ['U1ARAB'])
  channel('D1EMOJI', '', 'im', ['U1EMOJI'])
  channel('G1CROWD', 'mpdm-tushar--crowd', 'mpim', crowd.slice(0, 8))

  const post = (channel: string, userId: string, text: string, minutesAgo: number, threadTs?: string) =>
    workspace.post({ channel, user: userId, text, at: at(minutesAgo), silent: true, ...(threadTs === undefined ? {} : { threadTs: threadTs as never }) })

  const follow = (channel: string, root: { ts: string }, unread: number) => {
    const replies = workspace.replies(channel, root.ts as never)
    const lastRead = unread === 0 ? (replies.at(-1)?.ts ?? root.ts) : (replies.at(-1 - unread)?.ts ?? root.ts)
    workspace.subscriptions.set(`${channel}:${root.ts}`, { channel, threadTs: root.ts as never, lastRead: lastRead as never, subscribed: true, dateCreate: at(60) })
  }

  // A thread with an unbroken title, 1 200 unread replies and 30 participants (count 99+).
  const unbroken = post('C1LONG', 'U1LONG', UNBROKEN, 400)
  for (let i = 0; i < 1200; i++) post('C1LONG', crowd[i % crowd.length]!, `reply ${i}`, 399 - i * 0.3, unbroken.ts)
  follow('C1LONG', unbroken, 1200)

  // A URL title, few replies, emoji-only latest reply.
  const url = post('C1LONG', 'U0LEO', `${LONG_URL} is the doc`, 90)
  post('C1LONG', SELF_ID, 'on it', 80, url.ts)
  post('C1LONG', 'U1EMOJI', EMOJI_ONLY, 70, url.ts)
  follow('C1LONG', url, 1)

  // Main of the long channel: 1 500 unread messages from others.
  for (let i = 0; i < 1500; i++) post('C1LONG', crowd[i % crowd.length]!, `main message ${i}`, 300 - i * 0.1)
  workspace.reads.set('C1LONG', workspace.main('C1LONG')[0]!.ts)

  // CJK thread in a CJK channel.
  const cjk = post('C1CJK', 'U1CJK', CJK, 50)
  post('C1CJK', SELF_ID, 'はい、大丈夫です', 45, cjk.ts)
  post('C1CJK', 'U1CJK', 'ありがとうございます。資料を送ります。', 40, cjk.ts)
  follow('C1CJK', cjk, 1)
  workspace.reads.set('C1CJK', workspace.main('C1CJK').at(-1)!.ts)

  // Arabic DM thread, RTL.
  const arabic = post('D1ARAB', 'U1ARAB', ARABIC, 30)
  post('D1ARAB', SELF_ID, 'نعم، لنفعل ذلك', 25, arabic.ts)
  post('D1ARAB', 'U1ARAB', 'شكرًا جزيلًا', 20, arabic.ts)
  follow('D1ARAB', arabic, 1)
  workspace.reads.set('D1ARAB', workspace.main('D1ARAB').at(-1)!.ts)

  // Emoji-only root and reply in a DM with an emoji-named person.
  const emoji = post('D1EMOJI', 'U1EMOJI', EMOJI_ONLY, 15)
  post('D1EMOJI', SELF_ID, '🙌', 12, emoji.ts)
  post('D1EMOJI', 'U1EMOJI', '🥳', 10, emoji.ts)
  follow('D1EMOJI', emoji, 1)
  workspace.reads.set('D1EMOJI', workspace.main('D1EMOJI').at(-1)!.ts)

  // A private channel thread, so the row's private-ness can be looked for.
  const priv = post('C1PRIV', 'U0SAM', 'Private: the vendor contract renewal numbers', 35)
  post('C1PRIV', SELF_ID, 'looking', 34, priv.ts)
  follow('C1PRIV', priv, 0)
  workspace.reads.set('C1PRIV', workspace.main('C1PRIV').at(-1)!.ts)

  // A group DM Main with eight people, unread.
  for (let i = 0; i < 5; i++) post('G1CROWD', crowd[i]!, `group message ${i}`, 60 - i)
  workspace.reads.set('G1CROWD', workspace.main('G1CROWD')[0]!.ts)
}
