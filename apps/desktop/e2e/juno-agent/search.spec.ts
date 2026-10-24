import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test as chatTest } from './chat'

const test = chatTest.extend({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer: (request) => {
      const alerts = request.input.includes('alerts')
      const local = request.input.includes('local fallback')
      if (request.toolResult === undefined) return { toolCall: { name: 'slack_search', arguments: {
        query: alerts ? 'agentalert in:#eng' : local ? 'agentfallback' : 'vendorcontract from:@maya in:#eng',
        ...(request.input.includes('including bots') ? { includeApps: true } : {}),
      } } }
      const handle = /\b(m\d+) #eng/.exec(request.toolResult)?.[1]
      if (handle === undefined) return '<say>No matching messages.</say>'
      if (local) return `<say><src m="${handle}">Maya has the local fallback</src>. Slack search is unavailable.</say>`
      if (alerts) return `<say><src m="${handle}">Grafana reported the agentalert</src>.</say>`
      return `<say><src m="${handle}">Maya moved the vendorcontract cutover to Monday</src>.</say>`
    } })
    await use(model)
    await model.close()
  },
})

test('Juno searches older Slack history, cites its thread, includes bots on request and explains a local fallback', async ({ juno, fake, model }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
  const old = fake.now() - 40 * 86400_000
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'Vendor renewal discussion', at: old, silent: true })
  const reply = fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'The vendorcontract cutover moved to Monday.', threadTs: root.ts, at: old + 1000, silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0GRAFANA', text: 'agentalert: latency above threshold', at: old + 2000, silent: true })
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'agentfallback is available locally.' })
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const chat = JunoChatPane.tab(juno.win)
  const result = (ask: string) => model.requests.findLast((r) => r.input.includes(ask) && r.toolResult !== undefined)?.toolResult ?? ''

  await test.step('an uncached old reply is found and its citation opens the thread at the message', async () => {
    await chat.send('Find the vendorcontract cutover decision')
    await chat.expectJuno('Maya moved the vendorcontract cutover to Monday.')
    expect(result('vendorcontract')).toContain(`topic t:C0ENG:${root.ts}`)
    expect(result('vendorcontract')).toContain(`ts ${reply.ts}`)
    await chat.junoBubble('Maya moved the vendorcontract cutover to Monday.').locator('[data-source]').click()
    await expect(juno.topic.scroller.locator('[data-message-row]').filter({ hasText: 'The vendorcontract cutover moved to Monday.' })).toBeVisible()
    await juno.nav.back()
    await expect(chat.composer).toBeVisible()
  })
  await test.step('the same alert is hidden by default and found when the model includes apps', async () => {
    await chat.send('Find alerts')
    await chat.expectJuno('No matching messages.')
    expect(result('Find alerts')).not.toContain('latency above threshold')
    const calls = fake.callCount('search.modules.messages')
    await chat.send('Find alerts including bots')
    await chat.expectJuno('Grafana reported the agentalert.')
    expect(result('including bots')).toContain('latency above threshold')
    expect(fake.callCount('search.modules.messages') - calls).toBe(1)
  })
  await test.step('Slack failure keeps local matches and tells the model history is incomplete', async () => {
    fake.forceError({ method: 'search.modules.messages', error: 'invalid_args' })
    await chat.send('Find the local fallback')
    await chat.expectJuno('Maya has the local fallback. Slack search is unavailable.')
    expect(result('local fallback')).toContain('agentfallback is available locally.')
    expect(result('local fallback')).toContain('older history may be missing')
  })
})
