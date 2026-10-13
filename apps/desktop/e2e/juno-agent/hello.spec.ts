import { rm } from 'node:fs/promises'
import { expect, hooks, launchApp, tempUserData, test } from '../fixtures'

// Main forks the agent utility process, brokers a port between it and the
// engine, and the agent's host.hello reaches the engine's AgentHost server.
test('the agent process reaches its host over the brokered port', async () => {
  const userData = await tempUserData()
  const { app, close } = await launchApp(userData, { agent: true })
  try {
    await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')
    expect(await hooks(app, 'agentHost')).toBe('juno')
  } finally {
    await close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('the agent process stays off by default', async ({ app }) => {
  await expect.poll(() => hooks(app, 'engineState'), { timeout: 15_000 }).toBe('ready')
  expect(await hooks(app, 'agentState')).toBe('stopped')
})
