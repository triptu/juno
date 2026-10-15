import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { Juno } from '../driver/juno'
import { launchApp } from '../fixtures'
import { card, openChat, ready } from './agent'
import { expect, test as base } from './chat'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer: (request) => {
      const topic = /resolve (m:C\w+)/.exec(request.input)?.[1]
      return topic && request.toolResult === undefined
        ? { toolCall: { name: 'topics_resolve', arguments: { topicIds: [topic] } } }
        : '<say>Ready for your click.</say>'
    } })
    await use(model)
    await model.close()
  },
})

test.describe.configure({ timeout: 120_000 })

test('double clicking Resolve still leaves one usable Undo', async ({ juno }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('resolve m:C0ENG')
  const resolve = card(chat, 'resolve')
  await expect(resolve).toHaveAttribute('data-card-status', 'open')
  await resolve.getByRole('button', { name: 'Resolve', exact: true }).dblclick()
  await expect(resolve).toContainText('Resolved')
  await expect(juno.sidebar.row('#eng').root).toHaveCount(0)
  await resolve.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(resolve).toContainText('Undone')
  await juno.sidebar.row('#eng').expectVisible()
})

test('a resolved card can be undone after an app restart', async ({ juno, running, userData, fake, slackApp, model }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('resolve m:C0ENG')
  const resolve = card(chat, 'resolve')
  await expect(resolve).toHaveAttribute('data-card-status', 'open')
  await resolve.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(resolve).toContainText('Resolved')
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.waitForSync()
    const restored = card(await openChat(restarted), 'resolve')
    await restored.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(restored).toContainText('Undone')
    await restarted.sidebar.row('#eng').expectVisible()
  } finally {
    await again.close()
  }
})

test('AI off with an open Resolve card does not resolve its topic', async ({ juno, running, userData, fake, slackApp, model }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('resolve m:C0ENG')
  await expect(card(chat, 'resolve')).toHaveAttribute('data-card-status', 'open')
  await chat.expectJuno('Ready for your click.')
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  try {
    db.prepare("INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run()
  } finally {
    db.close()
  }
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.waitForSync()
    const off = await openChat(restarted)
    await expect(off.composer).toBeDisabled()
    await expect(off.root.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0)
    await restarted.sidebar.row('#eng').expectVisible()
  } finally {
    await again.close()
  }
})
