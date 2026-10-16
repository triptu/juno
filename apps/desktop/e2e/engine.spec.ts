import { expect, hooks, test } from './fixtures'

// The engine's diagnostic line sits in Settings › About of the signed-in
// shell, so every test here signs in and opens it first.
test('answers a command from the engine', async ({ juno }) => {
  await juno.signIn()
  await juno.openSettings('About')
  await expect(juno.settings.engineStatus).toHaveText('Engine live')
  const ping = juno.settings.pingButton
  await ping.click()
  await expect(juno.settings.root.getByText('Pong 2')).toBeVisible()
  await ping.click()
  await expect(juno.settings.root.getByText('Pong 3')).toBeVisible()
})

test('is served from the juno: scheme', async ({ win }) => {
  await expect(win.getByRole('heading', { name: "Hi, I'm Juno", exact: true })).toBeVisible()
  expect(await win.evaluate(() => location.protocol)).toBe('juno:')
  expect(await win.evaluate(() => location.href)).toBe('juno://app/index.html?theme=system&accent=coral&density=comfortable&sidebar=384')
  // Nothing outside the renderer folder is served: a traversal attempt ends
  // as a 404 (Chromium normalises the path; main refuses what is left).
  const escaped = await win.evaluate(() =>
    fetch('juno://app/../../package.json').then(
      (r) => r.status,
      () => 'failed',
    ),
  )
  expect(escaped).toBe(404)
})

test('recovers after the engine process is killed', async ({ juno, app }) => {
  await juno.signIn()
  await juno.openSettings('About')
  const line = juno.settings.engineStatus
  await expect(line).toHaveText('Engine live')
  const pid = await hooks(app, 'enginePid')
  expect(pid).toBeDefined()

  process.kill(pid!, 'SIGKILL')

  // The port closes, the renderer notices, main restarts the engine, the
  // renderer gets a new port and the live query delivers a fresh snapshot.
  // The new engine picks the stored session up from main on its own.
  await expect(line).toHaveText('Engine restarting', { timeout: 10_000 })
  await expect(line).toHaveText('Engine live', { timeout: 15_000 })
  await expect.poll(() => hooks(app, 'enginePid'), { timeout: 15_000 }).not.toBe(pid)
  // The renderer hears "live" over the new port before main's supervisor records ready.
  await expect.poll(() => hooks(app, 'engineState'), { timeout: 15_000 }).toBe('ready')

  // Commands work on the new port too.
  await juno.settings.pingButton.click()
  await expect(juno.settings.root.getByText(/Pong \d+/)).toBeVisible()
})

test('says so when the supervisor gives up on the engine', async ({ juno, app }) => {
  await juno.signIn()
  await juno.openSettings('About')
  const line = juno.settings.engineStatus
  await expect(line).toHaveText('Engine live')

  await hooks(app, 'failEngine')

  // The port closes; the renderer asks for a new one and is told there will
  // be none. No restart is attempted.
  await expect(line).toHaveText('Engine failed', { timeout: 15_000 })
  expect(await hooks(app, 'engineState')).toBe('failed')
  expect(await hooks(app, 'enginePid')).toBeUndefined()
})

test('says so under the filters when the engine stops for good, and Restart brings it back', async ({ juno, app }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  await sidebar.expectNoSyncStatus()

  await hooks(app, 'failEngine')

  // The rows stay; the line under the filters says what happened and offers the one action.
  await sidebar.expectSyncStatus('Sync stopped')
  await sidebar.expectRows()
  expect(await hooks(app, 'engineState')).toBe('failed')

  await sidebar.restartButton.click()
  await sidebar.expectNoSyncStatus(30_000)
  await expect.poll(() => hooks(app, 'engineState'), { timeout: 30_000 }).toBe('ready')
  await juno.expectEngineLive()
  await sidebar.expectRows()
})
