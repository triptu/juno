// Helpers for the draft sync flows (`flows/drafts*.flow.test.ts`): the Main's draft in Juno's store and what Juno
// sent to the fake Slack.
import { draftsSet, messagesSend } from '@juno/contract'
import { runCommand } from '@juno/state'
import { waitFor, type RunningEngine } from './harness'
import { apiCalls, readDb, valueOf } from './scenario'

export const MAIN = 'm:C0ENG'
/** A pause long enough that a few commands in a row always land inside it. */
export const PAUSE = 1_000

export const type = async (engine: RunningEngine, text: string, now = false) => valueOf(await runCommand(engine.registry, draftsSet, { topicId: MAIN, text, ...(now ? { now } : {}) }))
export const stored = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT text FROM drafts WHERE topic_id = ?').get(MAIN) as { text: string } | undefined)?.text)
/** Juno links Slack's draft and owes it nothing. */
export const settled = (engine: RunningEngine) =>
  readDb(engine, 'user.db', (db) => {
    const link = (db.prepare('SELECT slack_id FROM draft_sync WHERE topic_id = ?').get(MAIN) as { slack_id: string | null } | undefined)?.slack_id
    const owed = db.prepare("SELECT 1 FROM outbox WHERE kind = 'draft' AND target_key = ?").get(MAIN) !== undefined
    return link !== null && link !== undefined && !owed ? link : undefined
  })
export const draftCalls = (engine: RunningEngine) => engine.fake.calls.filter((call) => call.kind === 'api' && ['drafts.create', 'drafts.update', 'drafts.delete'].includes(call.method))
/** The Slack draft Juno links for the Main, owed or not. */
export const linked = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT slack_id FROM draft_sync WHERE topic_id = ?').get(MAIN) as { slack_id: string | null } | undefined)?.slack_id ?? undefined)
/** Whether the Main has a pending `draft` row. */
export const owed = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare("SELECT 1 FROM outbox WHERE kind = 'draft' AND target_key = ?").get(MAIN) !== undefined)
/** What Juno sent from the Main, with the draft each text went from. */
export const sentRecords = (engine: RunningEngine) =>
  readDb(engine, 'user.db', (db) => JSON.parse((db.prepare('SELECT sent_json FROM draft_sync WHERE topic_id = ?').get(MAIN) as { sent_json: string | null } | undefined)?.sent_json ?? '[]') as ReadonlyArray<{ readonly id?: string; readonly settled?: boolean }>)
/** The post made after the first `before`, once it reaches Slack. */
export const nextPost = (engine: RunningEngine, before: number) => waitFor(() => apiCalls(engine, 'chat.postMessage')[before], 15_000, 'the post at Slack')
/** Whether the post is waiting for Retry, or still on its way: Slack has not taken it. */
export const postState = (engine: RunningEngine, clientMsgId: string) =>
  readDb(engine, 'user.db', (db) => (db.prepare('SELECT state FROM pending_messages WHERE client_msg_id = ?').get(clientMsgId) as { state: string } | undefined)?.state)
export const hasFiles = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT has_files FROM draft_sync WHERE topic_id = ?').get(MAIN) as { has_files: number } | undefined)?.has_files === 1)
export const postFailed = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare("SELECT 1 FROM pending_messages WHERE state = 'failed'").get() !== undefined)
/** The local text Juno keeps for ⌘Z. */
export const kept = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT replaced FROM draft_sync WHERE topic_id = ?').get(MAIN) as { replaced: string | null } | undefined)?.replaced ?? undefined)
export const THREAD = 'Draft plan is in the doc'
export const send = async (engine: RunningEngine, text: string, threadTs?: string) =>
  valueOf(await runCommand(engine.registry, messagesSend, { to: { kind: 'channel', channelId: 'C0ENG', ...(threadTs === undefined ? {} : { threadTs }) }, text, clientMsgId: crypto.randomUUID(), draftOf: MAIN }))
