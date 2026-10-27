// Juno's Resolve card: it waits for approval, a double click resolves once, Undo survives a
// restart, and with AI assist off an open card resolves nothing.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { chatCopy } from '@juno/agent-contract'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { card, openChat, readySynced as ready } from '../driver/agent'
import { expect } from '../expect'
import { domTest } from '../test'

const model = () => startFakeOpenRouter({ answer: (request) => {
  const topic = /resolve (m:C\w+)/.exec(request.input)?.[1]
  return topic && request.toolResult === undefined
    ? { toolCall: { name: 'topics_resolve', arguments: { topicIds: [topic] } } }
    : '<say>Ready for your click.</say>'
} })

domTest('Resolve waits for approval, double clicking resolves once, Undo survives a restart, and AI off with an open card resolves nothing', async ({ juno, relaunch, userData, fake }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('resolve m:C0ENG')
  const resolve = card(chat, 'resolve')
  await expect(resolve).toHaveAttribute('data-card-status', 'open', { timeout: 15_000 })
  await juno.sidebar.row('#eng').expectVisible()
  await resolve.getByRole('button', { name: 'Resolve', exact: true }).dblclick()
  await expect(resolve).toContainText('Resolved')
  await expect(juno.sidebar.row('#eng').root).toHaveCount(0)
  const restarted = await relaunch()
  await restarted.waitForSync()
  const again = await openChat(restarted)
  const restored = card(again, 'resolve')
  await restored.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(restored).toContainText('Undone')
  await restarted.sidebar.row('#eng').expectVisible()

  // A second Resolve card, left open, then AI assist turned off while the app is closed.
  const answered = await again.junoBubble('Ready for your click.').count()
  await again.send('resolve m:C0ENG')
  await expect(card(again, 'resolve')).toHaveCount(2)
  await expect(card(again, 'resolve').last()).toHaveAttribute('data-card-status', 'open')
  await expect(again.junoBubble('Ready for your click.')).toHaveCount(answered + 1, { timeout: 15_000 })
  const off = await relaunch({ whileClosed: async () => {
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
    try {
      db.prepare("INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run()
    } finally { db.close() }
  } })
  await off.waitForSync()
  const offChat = await openChat(off)
  await expect(offChat.root.getByText(chatCopy.banner.aiOff.line)).toBeVisible()
  await expect(offChat.composer).toBeDisabled()
  await expect(offChat.root.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0)
  await off.sidebar.row('#eng').expectVisible()
}, { model })
