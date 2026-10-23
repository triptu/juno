import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** The decision logged for the message whose text holds `text` (what Today › Details shows), or undefined before there is one. */
export function loggedDecision(userData: string, teamId: string, text: string): { readonly outcome: string; readonly decidedBy: string } | undefined {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'user.db'), { readOnly: true })
  try {
    return db.prepare('SELECT outcome, decided_by AS decidedBy FROM notification_log WHERE preview LIKE ?').get(`%${text}%`) as { outcome: string; decidedBy: string } | undefined
  } finally {
    db.close()
  }
}

/** Whether a message with this text is in the synced mirror, as Slack sent it back. */
export function syncedMessage(userData: string, teamId: string, text: string): boolean {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
  try {
    return db.prepare('SELECT 1 FROM messages WHERE text = ? AND deleted = 0').get(text) !== undefined
  } finally {
    db.close()
  }
}
