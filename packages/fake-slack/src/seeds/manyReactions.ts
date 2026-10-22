/**
 * A message with many reactions, for the "who reacted" dialog: 40 people on
 * 👍 (you third), 28 on 🎉, and ten more emoji with fewer, four of them the
 * workspace's custom emoji (one an alias). The reactors are new people with
 * long names. Pages list at most `REACTORS_LISTED` of them per emoji
 * (`reactors.ts`), so 👍 and 🎉 arrive cut short and the full list needs
 * `reactions.get` with `full`.
 *
 * The reactions are set without socket events, as a page would bring them:
 * events would hand the app every reactor one by one. The post itself is a
 * normal message (or silent, before the app signs in).
 */
import { WORKSPACE_EMOJI } from '../emoji.ts'
import { SELF_ID, userObject } from '../fixtures.ts'
import type { Workspace } from '../state.ts'
import type { Reaction } from '@juno/slack-schema'

export interface ManyReactionsInput {
  /** Default `C0ENG`. */
  readonly channel?: string
  /** Default `U0MAYA`. */
  readonly user?: string
  readonly text?: string
  /** Store the post without socket events, for a seed made before the app signs in. */
  readonly silent?: boolean
}

export interface ManyReactionsSeed {
  readonly channel: string
  readonly ts: string
  readonly text: string
  /** Every reaction in Slack's order, with everyone who reacted. */
  readonly reactions: ReadonlyArray<{ readonly name: string; readonly users: ReadonlyArray<string> }>
  /** The new people's display names (their whole names) by id. */
  readonly names: Readonly<Record<string, string>>
}

const FIRST = ['Alexandria', 'Bartholomew', 'Constantina', 'Desmond', 'Evangeline', 'Florentino', 'Genevieve', 'Hieronymus', 'Isadora', 'Jacqueline', 'Konstantin', 'Leopoldina', 'Maximilian']
const LAST = ['Featherstonehaugh', 'Montgomery-Whitfield', 'Vandenberghe', 'Okonkwo-Adeyemi', 'Wolfeschlegel']
const COLORS = ['3c989f', 'e7392d', '9b3b45', '4bbe2e', 'df3dc0', '235e5b', 'e96699', '8d4b84']

/** Reactions after 👍 and 🎉, in Slack's order: [name, how many]. */
const OTHERS: ReadonlyArray<readonly [string, number]> = [
  ['juno_party', 12],
  ['heart', 9],
  ['juno_shipit', 7],
  ['eyes', 5],
  ['rocket', 4],
  ['hello_juno', 3],
  ['fire', 3],
  ['pray', 2],
  ['juno_coffee', 2],
  ['100', 1],
]

const REACTORS = 39

/** Adds the people, the emoji the reactions need, the message and its reactions. `avatarBase` is where the fake serves photos (`<fake url>/avatars`). */
export function seedManyReactions(workspace: Workspace, avatarBase: string, input: ManyReactionsInput = {}): ManyReactionsSeed {
  const channel = input.channel ?? 'C0ENG'
  const text = input.text ?? 'Launch day: the new onboarding is live for everyone.'
  const names: Record<string, string> = {}
  const people: Array<string> = []
  for (let i = 0; i < REACTORS; i++) {
    const id = `U0RX${String(i + 1).padStart(2, '0')}`
    const realName = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`
    names[id] = realName
    people.push(id)
    if (!workspace.users.has(id)) {
      const user = userObject({ id, name: realName.toLowerCase().replace(/[^a-z]+/g, '.'), realName, title: '', color: COLORS[i % COLORS.length]!, tz: 'Europe/Paris' }, avatarBase)
      // Their whole name is their display name, so it is what Juno shows.
      workspace.addUser({ ...user, profile: { ...user.profile, display_name: realName, display_name_normalized: realName } })
    }
  }
  const emojiBase = avatarBase.replace(/\/avatars$/, '/emoji')
  for (const name of ['juno_party', 'juno_shipit', 'juno_coffee', 'juno_wave']) {
    if (!workspace.emoji.has(name) && WORKSPACE_EMOJI[name] !== undefined) workspace.emoji.set(name, { name, value: `${emojiBase}/${name}.svg` })
  }
  if (!workspace.emoji.has('hello_juno')) workspace.emoji.set('hello_juno', { name: 'hello_juno', value: 'alias:juno_wave' })

  const message = workspace.post({ channel, user: input.user ?? 'U0MAYA', text, ...(input.silent === true ? { silent: true } : {}) })
  const reactions: Array<Reaction> = [
    { name: '+1', users: [...people.slice(0, 2), SELF_ID, ...people.slice(2)], count: REACTORS + 1 },
    { name: 'tada', users: people.slice(5, 33), count: 28 },
    ...OTHERS.map(([name, count], i): Reaction => {
      const users = Array.from({ length: count }, (_, k) => people[(i * 3 + k) % people.length]!)
      return { name, users, count }
    }),
  ]
  const list = workspace.all(channel)
  const index = list.findIndex((m) => m.ts === message.ts)
  list[index] = { ...list[index]!, reactions }
  // A conditional page sends the message again, reactions and all.
  workspace.messageVersions.set(`${channel}:${message.ts}`, workspace.eventTs())
  return { channel, ts: message.ts, text, reactions: reactions.map((r) => ({ name: r.name, users: r.users ?? [] })), names }
}
