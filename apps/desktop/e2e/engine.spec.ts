import { expect, hooks, test } from './fixtures'

// The engine's diagnostic line sits in the account menu of the signed-in
// shell, so every test here signs in and opens the menu first.
test('shows the engine status that arrives over the port', async ({ juno }) => {
  await juno.signIn()
  await juno.accountMenu.open()
  await expect(juno.accountMenu.engineStatus).toHaveText('Engine live')
})

test('answers a command from the engine', async ({ juno }) => {
  await juno.signIn()
  await juno.accountMenu.open()
  await expect(juno.accountMenu.engineStatus).toHaveText('Engine live')
  const ping = juno.accountMenu.pingButton
  await ping.click()
  await expect(juno.accountMenu.root.getByText('Pong 2')).toBeVisible()
  await ping.click()
  await expect(juno.accountMenu.root.getByText('Pong 3')).toBeVisible()
})

test('is served from the juno: scheme', async ({ win }) => {
  await expect(win.getByRole('heading', { name: "Hi, I'm Juno", exact: true })).toBeVisible()
  expect(await win.evaluate(() => location.protocol)).toBe('juno:')
  expect(await win.evaluate(() => location.href)).toBe('juno://app/index.html?theme=light&accent=coral')
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
  await juno.accountMenu.open()
  const line = juno.accountMenu.engineStatus
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
  await juno.accountMenu.pingButton.click()
  await expect(juno.accountMenu.root.getByText(/Pong \d+/)).toBeVisible()
})

test('says so when the supervisor gives up on the engine', async ({ juno, app }) => {
  await juno.signIn()
  await juno.accountMenu.open()
  const line = juno.accountMenu.engineStatus
  await expect(line).toHaveText('Engine live')

  await hooks(app, 'failEngine')

  // The port closes; the renderer asks for a new one and is told there will
  // be none. No restart is attempted.
  await expect(line).toHaveText('Engine failed', { timeout: 15_000 })
  expect(await hooks(app, 'engineState')).toBe('failed')
  expect(await hooks(app, 'enginePid')).toBeUndefined()
})
