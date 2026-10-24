import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Slack } from './slack'

/** Reads the workspace's user.db while the app runs, so a test can wait for a save to land before it relaunches. */
export function readUserDb<A>(userData: string, teamId: string, read: (db: DatabaseSync) => A): A {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'user.db'), { readOnly: true })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

/** The message is in the workspace's cache.db: an event or a page the app received has been stored. */
export function messageStored(userData: string, teamId: string, channel: string, ts: string): boolean {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
  try {
    return db.prepare('SELECT 1 AS found FROM messages WHERE channel = ? AND ts = ?').get(channel, ts) !== undefined
  } finally {
    db.close()
  }
}

/** The tabs saved in user.db (`TABS_PREF` in `@juno/state`): each tab's topic id, or its page, whether it is pinned, and which tab is active. */
export function savedTabs(userData: string, teamId: string): { readonly tabs: Array<{ readonly place: string; readonly pinned: boolean }>; readonly active: number } | undefined {
  const row = readUserDb(userData, teamId, (db) => db.prepare(`SELECT value_json FROM prefs WHERE key = 'tabs'`).get()) as { value_json: string } | undefined
  if (row === undefined) return undefined
  const saved = JSON.parse(row.value_json) as { tabs: Array<{ id: string; pinned: boolean; place: { kind: string; topicId?: string } }>; active: string | null }
  return { tabs: saved.tabs.map((tab) => ({ place: tab.place.topicId ?? tab.place.kind, pinned: tab.pinned })), active: saved.tabs.findIndex((tab) => tab.id === saved.active) }
}

/** A thread's topic id, by its root's text. */
export function threadId(slack: Slack, text: string): string {
  const { channel, ts } = slack.root(text)
  return `t:${channel}:${ts}`
}
