import type { File, Message, RichTextElement, Ts } from '@juno/slack-schema'
import { SELF_ID, TEAM } from '../fixtures.ts'
import { NEVER_READ, type Workspace } from '../state.ts'

export const TOPIC300_MAIN_CHANNEL = 'C0PERFMAIN'
export const TOPIC300_THREAD_CHANNEL = 'C0PERFTHREAD'

/** A block taller than a row's size estimate by far, so rows differ from it as they do in real topics. */
const LONG_CODE = ['const steps = await checklist.load()', 'for (const step of steps) {', '  if (!step.done) await step.run()', '}', 'await checklist.save(steps)', 'console.log(steps.length)'].join('\n')

export interface Topic300Summary {
  readonly mainId: string
  readonly threadId: string
  readonly threadTs: Ts
}

/** Two 300-row windows, each with exactly 60 images and 45 code blocks, 15 of them six lines long. */
export function topic300Seed(): (workspace: Workspace, avatarBase: string) => Topic300Summary {
  return (workspace, avatarBase) => {
    const now = workspace.clock.now()
    const users = [SELF_ID, 'U0PERFLEO', 'U0PERFMAYA']
    for (const [index, id] of users.entries()) {
      const name = ['Tushar', 'Leo Park', 'Maya Chen'][index] ?? id
      workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name, avatar_hash: `fake${id.toLowerCase()}`, image_72: `${avatarBase}/${id}.svg` } })
    }
    for (const id of [TOPIC300_MAIN_CHANNEL, TOPIC300_THREAD_CHANNEL]) {
      workspace.addConversation({ id, name: id === TOPIC300_MAIN_CHANNEL ? 'perf-main' : 'perf-thread', kind: 'public', members: new Set(users), created: now, topic: '', purpose: '', isOpen: true, archived: false })
    }
    workspace.emoji.set('juno_wave', { name: 'juno_wave', value: `${avatarBase}/U0PERFLEO.svg` })
    let root: Message | undefined
    for (const channel of [TOPIC300_THREAD_CHANNEL, TOPIC300_MAIN_CHANNEL]) {
      for (let i = 0; i < 300; i++) {
        const text = `Review the rollout checklist ${i + 1}. The next step is ready for review.`
        const code = i % 10 === 3 ? 'const ready = true;\nconsole.log(ready);' : i % 20 === 17 ? LONG_CODE : undefined
        const url = `${avatarBase}/../files/F${channel}${i}/image.svg`
        const file: File = { id: `F${channel}${i}`, name: `diagram-${i}.svg`, mimetype: 'image/svg+xml', original_w: 800, original_h: 600, thumb_360_w: 360, thumb_360_h: 270, thumb_360: url, url_private: url }
        if (i % 5 === 0) {
          const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e5e7eb"/><path d="M100 400L300 200L500 350L700 100" fill="none" stroke="#64748b" stroke-width="12"/></svg>')
          workspace.files.set(file.id, { id: file.id, name: file.name ?? file.id, length: bytes.length, user: SELF_ID, created: now, bytes, mimetype: 'image/svg+xml' })
        }
        // Thread unread pages omit self's replies. Other senders make boot cache the whole window.
        const sender = channel === TOPIC300_THREAD_CHANNEL ? users[1 + Math.floor(i / 3) % 2] : users[Math.floor(i / 3) % users.length]
        const posted = workspace.post({
          channel, user: sender ?? SELF_ID, text,
          blocks: [{ type: 'rich_text', elements: [
            { type: 'rich_text_section', elements: [{ type: 'text', text }] },
            ...(code === undefined ? [] : [{ type: 'rich_text_preformatted', elements: [{ type: 'text', text: code }] } satisfies RichTextElement]),
          ] }],
          ...(i % 5 === 0 ? { files: [file] } : {}),
          ...(channel === TOPIC300_THREAD_CHANNEL && root !== undefined ? { threadTs: root.ts } : {}),
          at: now - (300 - i) * 60_000, silent: true,
        })
        if (channel === TOPIC300_THREAD_CHANNEL && root === undefined) root = posted
      }
      workspace.reads.set(channel, NEVER_READ)
    }
    if (root === undefined) throw new Error('The performance thread has no root')
    workspace.subscriptions.set(`${TOPIC300_THREAD_CHANNEL}:${root.ts}`, { channel: TOPIC300_THREAD_CHANNEL, threadTs: root.ts, lastRead: NEVER_READ, subscribed: true, dateCreate: now })
    return { mainId: `m:${TOPIC300_MAIN_CHANNEL}`, threadId: `t:${TOPIC300_THREAD_CHANNEL}:${root.ts}`, threadTs: root.ts }
  }
}
