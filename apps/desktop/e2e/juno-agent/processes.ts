// What the crash canary's clean relaunch checks besides the chat (`crash.spec.ts`): a codemode script in the
// agent's utility process, and About's process table, the content-free diagnostics, log rotation and an
// unhandled rejection in main.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { ElectronApplication } from '@playwright/test'
import { CONVERSATIONS, type FakeSlack } from '@juno/fake-slack'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { openChat, openPage, openRuns } from './agent'
import { expect } from './chat'

export const SCRIPT = 'where is the cutover plan?'

/** One codemode script that searches, then an answer citing what it read. */
export function codemodeAnswer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult === undefined) return { toolCall: { name: 'codemode', arguments: { code: "text(await tools.slack_search({ query: 'replication' }))" } } }
  return request.toolResult.includes('m1 ') ? '<say>It is in <src m="m1">the cutover plan</src>.</say>' : '<say>The script found nothing.</say>'
}

const LOG_LIMIT = 5 * 1024 * 1024
const LOGGED = ['main', 'engine', 'agent']

// A full previous log makes the real process writer rotate on its first append. Fifty warnings each, as
// a long-running install has, make the report far longer than a link or a line of text.
export async function seedFullLogs(userData: string): Promise<void> {
  const folder = join(userData, 'logs')
  await mkdir(folder, { recursive: true })
  for (const name of LOGGED) {
    const warnings = Array.from({ length: 50 }, (_, n) => `2026-10-18T00:00:00.000Z WARN ${name} outbox row failed rowId=${n + 1}\n`).join('')
    await writeFile(join(folder, `${name}.log`), ' '.repeat(LOG_LIMIT - warnings.length - 1) + '\n' + warnings)
  }
}

export async function codemode(juno: Juno, userData: string): Promise<void> {
  // The agent ran one script in the sandbox at start: the worker and the QuickJS binary loaded.
  await expect.poll(async () => JSON.parse(await readFile(join(userData, 'agent', 'codemode-probe.json'), 'utf8').catch(() => '{}')), { timeout: 20_000 }).toEqual({ ok: true, value: 12 })
  const chat = await openChat(juno)
  await chat.send(SCRIPT)
  await chat.expectJuno('It is in the cutover plan.')
  await expect(chat.junoBubble('It is in the cutover plan.').locator('[data-source]')).toHaveCount(1)
  const page = await openPage(juno, 'Activity')
  await openRuns(page)
  await expect(page.getByText('Ran 1 script: 1 read', { exact: true })).toBeVisible()
}

export async function diagnostics(juno: Juno, app: ElectronApplication, fake: FakeSlack, userData: string): Promise<void> {
  const { win } = juno
  const folder = join(userData, 'logs')
  await juno.sidebar.row('Draft plan is in the doc').open()
  fake.forceError({ method: 'chat.postMessage', error: 'restricted_action' })
  await juno.topic.send('Diagnostics private draft must never be logged')
  await expect(juno.topic.failed('Diagnostics private draft must never be logged').row).toContainText('Not sent.')
  await juno.openSettings('About')
  const table = win.getByRole('region', { name: 'Processes' })
  for (const name of ['Main', 'Window', 'Engine', 'Juno agent', 'Graphics', 'Network']) await expect(table.locator(`[data-process="${name}"]`)).toContainText(/\d+(\.\d)? %.*\d+ MB/)
  await expect(table.locator('[data-process="Engine"]')).toContainText(`Utility, pid ${await hooks(app, 'enginePid')}`)
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await win.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Juno diagnostics')
  const report = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(report).toContain('Engine: Engine live (process ready)')
  expect(report).toContain('post failed: 1')
  for (const word of ['Draft plan', '#eng', 'Maya', 'Tushar', 'xox', 'Diagnostics private draft']) expect(report).not.toContain(word)
  for (const name of LOGGED) {
    // The newest seeded warning. Warnings this run writes may push the oldest out of the last 50.
    expect(report).toMatch(new RegExp(`WARN ${name} outbox row failed rowId=50$`, 'm'))
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
}

export async function rejectionInMain(juno: Juno, app: ElectronApplication, userData: string): Promise<void> {
  await app.evaluate(() => (globalThis as unknown as { junoTest: { rejectInMain: () => void } }).junoTest.rejectInMain())
  const line = /ERROR main unhandled rejection cause=Error stack=\d+:\d+/
  await expect.poll(() => readFile(join(userData, 'logs', 'main.log'), 'utf8').catch(() => '')).toMatch(line)
  // Still running: the window answers and About copies the line.
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await juno.win.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(line)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBeGreaterThan(0)
}
