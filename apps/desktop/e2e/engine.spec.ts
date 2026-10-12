import { expect, hooks, test } from './fixtures'

test('shows the engine status that arrives over the port', async ({ win }) => {
  await expect(win.getByRole('status', { name: 'Engine status' })).toHaveText('Engine live')
})

test('answers a command from the engine', async ({ win }) => {
  await expect(win.getByRole('status', { name: 'Engine status' })).toHaveText('Engine live')
  const ping = win.getByRole('button', { name: 'Ping engine' })
  await ping.click()
  await expect(win.getByText('Pong 2')).toBeVisible()
  await ping.click()
  await expect(win.getByText('Pong 3')).toBeVisible()
})

test('is served from the juno: scheme', async ({ win }) => {
  await expect(win.getByRole('heading', { name: 'Juno' })).toBeVisible()
  expect(await win.evaluate(() => location.protocol)).toBe('juno:')
  expect(await win.evaluate(() => location.href)).toBe('juno://app/index.html?theme=light')
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

test('recovers after the engine process is killed', async ({ app, win }) => {
  const line = win.getByRole('status', { name: 'Engine status' })
  await expect(line).toHaveText('Engine live')
  const pid = await hooks(app, 'enginePid')
  expect(pid).toBeDefined()

  process.kill(pid!, 'SIGKILL')

  // The port closes, the renderer notices, main restarts the engine, the
  // renderer gets a new port and the live query delivers a fresh snapshot.
  await expect(line).toHaveText('Engine restarting', { timeout: 10_000 })
  await expect(line).toHaveText('Engine live', { timeout: 15_000 })
  await expect.poll(() => hooks(app, 'enginePid'), { timeout: 15_000 }).not.toBe(pid)
  expect(await hooks(app, 'engineState')).toBe('ready')

  // Commands work on the new port too.
  await win.getByRole('button', { name: 'Ping engine' }).click()
  await expect(win.getByText(/Pong \d+/)).toBeVisible()
})

test('says so when the supervisor gives up on the engine', async ({ app, win }) => {
  const line = win.getByRole('status', { name: 'Engine status' })
  await expect(line).toHaveText('Engine live')

  await hooks(app, 'failEngine')

  // The port closes; the renderer asks for a new one and is told there will
  // be none. No restart is attempted.
  await expect(line).toHaveText('Engine failed', { timeout: 15_000 })
  expect(await hooks(app, 'engineState')).toBe('failed')
  expect(await hooks(app, 'enginePid')).toBeUndefined()
})
