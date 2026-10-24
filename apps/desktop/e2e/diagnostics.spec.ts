import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONVERSATIONS } from '@juno/fake-slack'
import { Juno } from './driver/juno'
import { expect, hooks, launchApp, test } from './fixtures'

const LOG_LIMIT = 5 * 1024 * 1024
const processes = ['Main', 'Window', 'Engine', 'Juno agent', 'Graphics', 'Network']

test('About shows every process, copies content-free diagnostics and rotates each process log; an unhandled rejection in main is logged and the app keeps running', async ({ fake, slackApp, userData }) => {
  test.setTimeout(120_000)
  const folder = join(userData, 'logs')
  await mkdir(folder, { recursive: true })
  for (const name of ['main', 'engine', 'agent']) {
    // A full previous log makes the real process writer rotate on its first append. Fifty warnings each, as
    // a long-running install has, make the report far longer than a link or a line of text.
    const warnings = Array.from({ length: 50 }, (_, n) => `2026-10-18T00:00:00.000Z WARN ${name} outbox row failed rowId=${n + 1}\n`).join('')
    await writeFile(join(folder, `${name}.log`), ' '.repeat(LOG_LIMIT - warnings.length - 1) + '\n' + warnings)
  }
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true })
  try {
    const { app, win } = running
    const juno = new Juno(app, win)
    await juno.signIn()
    await juno.waitForSync()
    await juno.sidebar.row('Draft plan is in the doc').open()
    fake.forceError({ method: 'chat.postMessage', error: 'restricted_action' })
    await juno.topic.send('Diagnostics private draft must never be logged')
    await expect(juno.topic.failed('Diagnostics private draft must never be logged').row).toContainText('Not sent.')
    await juno.openSettings('About')
    const table = win.getByRole('region', { name: 'Processes' })
    for (const name of processes) await expect(table.locator(`[data-process="${name}"]`)).toContainText(/\d+(\.\d)? %.*\d+ MB/)
    const engine = await hooks(app, 'enginePid')
    await expect(table.locator('[data-process="Engine"]')).toContainText(`Utility, pid ${engine}`)
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await win.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
    await expect(win.getByText('Copied', { exact: true })).toBeVisible()
    const report = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(report.length).toBeGreaterThan(4096)
    expect(report).toMatch(/^Juno diagnostics\nJuno \S+ on \w+, Electron [\d.]+\n/)
    expect(report).toMatch(/\nView: Settings about, \d tabs?; window [a-z ]+\n/)
    expect(report).toMatch(/\nTabs: (Home|topic|All topics|Juno tab|Settings [a-z-]+|Juno page [a-z-]+)(, (Home|topic|All topics|Juno tab|Settings [a-z-]+|Juno page [a-z-]+))*\n/)
    expect(report).toContain('Engine: Engine live (process ready)')
    for (const word of ['Draft plan', '#eng', 'Maya', 'Tushar', 'xox']) expect(report).not.toContain(word)
    expect(report).toContain('Outbox counts by kind and state:')
    expect(report).toContain('post failed: 1')
    expect(report).not.toContain('Diagnostics private draft must never be logged')
    expect(report).toMatch(/macOS|linux|win32/)
    for (const name of processes) expect(report).toContain(name)
    for (const name of ['main', 'engine', 'agent']) {
      expect(report).toContain(`${name}: last 50 warnings and errors`)
      // The newest seeded warning. Warnings this run writes may push the oldest out of the last 50.
      expect(report).toMatch(new RegExp(`WARN ${name} outbox row failed rowId=50$`, 'm'))
      await expect.poll(async () => (await stat(join(folder, `${name}.log`))).size).toBeGreaterThan(0)
      expect((await stat(join(folder, `${name}.log`))).size).toBeLessThan(LOG_LIMIT)
      expect((await stat(join(folder, `${name}.log.1`))).size).toBe(LOG_LIMIT)
      const log = await readFile(join(folder, `${name}.log`), 'utf8')
      expect(log).toContain('INFO')
      for (const conversation of CONVERSATIONS) {
        for (const message of conversation.messages) {
          if (message.text.length > 15) { expect(report).not.toContain(message.text); expect(log).not.toContain(message.text) }
        }
      }
    }
    await win.getByRole('button', { name: 'Show logs in Finder' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { junoTest: { logsOpened: () => number } }).junoTest.logsOpened())).toBe(1)

    await test.step('an unhandled rejection in main is logged with its stack, and the app keeps running', async () => {
      await app.evaluate(() => (globalThis as unknown as { junoTest: { rejectInMain: () => void } }).junoTest.rejectInMain())
      const line = /ERROR main unhandled rejection cause=Error stack=\d+:\d+/
      await expect.poll(() => readFile(join(folder, 'main.log'), 'utf8').catch(() => '')).toMatch(line)
      // Still running: the window answers and About copies the line. The clipboard still holds the report above.
      await app.evaluate(({ clipboard }) => clipboard.clear())
      await win.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(line)
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBeGreaterThan(0)
    })
  } finally { await running.close() }
})
