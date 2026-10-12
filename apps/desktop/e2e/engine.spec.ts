import type { Locator } from '@playwright/test'
import { expect, hooks, test } from './fixtures'

/** Reads the seconds from "Engine live, up 12 s". */
async function uptimeSeconds(line: Locator): Promise<number> {
  const text = await line.textContent()
  const match = /up (\d+) s/.exec(text ?? '')
  if (!match) throw new Error(`no uptime in "${text}"`)
  return Number(match[1])
}

test('shows the engine status that arrives over the port', async ({ win }) => {
  const line = win.getByRole('status', { name: 'Engine status' })
  await expect(line).toHaveText(/Engine live, up \d+ s/)

  // The live query keeps delivering: the uptime moves without any input.
  const before = await uptimeSeconds(line)
  await expect.poll(() => uptimeSeconds(line), { timeout: 5_000 }).toBeGreaterThan(before)
})

test('answers a command from the engine', async ({ win }) => {
  await expect(win.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine live/)
  const ping = win.getByRole('button', { name: 'Ping engine' })
  await ping.click()
  await expect(win.getByText('Pong 2')).toBeVisible()
  await ping.click()
  await expect(win.getByText('Pong 3')).toBeVisible()
})

test('is served from the juno: scheme', async ({ win }) => {
  await expect(win.getByRole('heading', { name: 'Juno' })).toBeVisible()
  expect(await win.evaluate(() => location.protocol)).toBe('juno:')
  expect(await win.evaluate(() => location.href)).toBe('juno://app/index.html')
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
  await expect(line).toHaveText(/Engine live/)
  const pid = await hooks(app, 'enginePid')
  expect(pid).toBeDefined()

  process.kill(pid!, 'SIGKILL')

  // The port closes, the renderer notices, main restarts the engine, the
  // renderer gets a new port and the live query delivers a fresh snapshot.
  await expect(line).toHaveText('Engine restarting', { timeout: 10_000 })
  await expect(line).toHaveText(/Engine live, up [0-4] s/, { timeout: 15_000 })
  await expect.poll(() => hooks(app, 'enginePid'), { timeout: 15_000 }).not.toBe(pid)
  expect(await hooks(app, 'engineState')).toBe('ready')

  // Commands work on the new port too.
  await win.getByRole('button', { name: 'Ping engine' }).click()
  await expect(win.getByText(/Pong \d+/)).toBeVisible()
})
