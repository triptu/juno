// Steps the Juno Agent flows share: getting the app ready, opening the chat and its pages,
// connecting a fake MCP server by address, and launching with a crash point armed.
import type { ElectronApplication, Locator } from '@playwright/test'
import { CRASH_ENV, type CrashPoint } from '@juno/agent/crash'
import type { AppSurface } from '../driver/surface'
import type { Juno } from '../driver/juno'
import { hooks, launchApp, type LaunchOptions, type RunningApp } from '../fixtures'
import { expect, JunoChatPane } from './chat'

export type JunoPage = 'Scheduled' | 'What Juno remembers' | 'Memory of this chat' | 'Activity' | 'Connections'

/** The sections of Settings the Juno Agent's flows use. */
export type JunoSettingsSection = 'Juno' | 'AI activity' | 'Connections' | 'Backup & This Mac'

/** Signs in, waits for the first sync and for the agent. */
export async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await agentReady(juno.surface)
}

/** An established workspace starts from the synced fixture; only the agent needs waiting. */
export async function readySynced(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await agentReady(juno.surface)
}

export async function agentReady(app: ElectronApplication | AppSurface): Promise<void> {
  await expect.poll(() => hooks(app, 'agentState'), { timeout: 30_000 }).toBe('ready')
}

/** Opens the Juno tab and returns its chat. */
export async function openChat(juno: Juno): Promise<JunoChatPane> {
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  await juno.tabs.expectActive('Juno')
  return JunoChatPane.tab(juno.win)
}

/** Opens one of the Juno menu's pages from the Juno tab and returns the page. Connections opens in Settings. */
export async function openPage(juno: Juno, label: JunoPage): Promise<Locator> {
  await openChat(juno)
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: label }).click()
  await juno.tabs.expectActive(label === 'Connections' ? 'Settings' : label)
  return juno.win.locator('main')
}

/** Opens every run on the Activity page, so each shows its steps and actions. */
export async function openRuns(page: Locator): Promise<void> {
  const closed = page.locator('[data-activity-run] button[aria-expanded="false"]')
  for (let n = await closed.count(); n > 0; n = await closed.count()) await closed.first().click()
}

/** Opens Settings from the Juno menu, which lands on its Juno section, then goes to `section`. Returns the page. */
export async function openSettings(juno: Juno, section: JunoSettingsSection): Promise<Locator> {
  await openChat(juno)
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: 'Settings' }).click()
  await juno.tabs.expectActive('Settings')
  const nav = juno.win.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('button', { name: 'Juno' })).toHaveAttribute('aria-current', 'page')
  if (section !== 'Juno') await nav.getByRole('button', { name: section }).click()
  await expect(nav.getByRole('button', { name: section })).toHaveAttribute('aria-current', 'page')
  return juno.win.locator('main')
}

/** A card in the chat, by kind (`sendMessage`, `change`, `proposedTask`, `task`, `question`, `budget`, `remove`, `schedule`, ...). */
export function card(chat: JunoChatPane, kind: string): Locator {
  return chat.root.locator(`[data-chat-card="${kind}"]`)
}

/**
 * Adds an MCP server on Connections by its address, signs in (the fakes approve at once under
 * JUNO_E2E) and returns the server's id and its row. Leaves Connections open.
 */
export async function addServer(juno: Juno, name: string, url: string): Promise<{ readonly id: string; readonly row: Locator }> {
  const page = await openPage(juno, 'Connections')
  const add = page.locator('[data-add-server]')
  await add.getByLabel('Name').fill(name)
  await add.getByLabel('Address').fill(url)
  await add.getByRole('button', { name: 'Add' }).click()
  const row = page.locator('[data-connection-id^="server-"]').filter({ hasText: url })
  await expect(row.locator('[data-connection-name]')).toHaveText(name)
  const id = await row.getAttribute('data-connection-id')
  if (id === null) throw new Error(`No connection id for ${name}`)
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-connection', 'ready', { timeout: 20_000 })
  return { id, row }
}

/**
 * Launches the app with the agent set to kill itself (SIGKILL) at `point`, on its `nth` hit
 * (`runtime/crash.ts`). Main restarts a killed agent with the same setting, so close this
 * launch once the kill is seen and relaunch with `launchApp` to recover.
 */
export async function launchArmed(userData: string, options: LaunchOptions, point: CrashPoint, nth = 1): Promise<RunningApp> {
  return launchApp(userData, { ...options, agentCrash: nth === 1 ? point : `${point}:${nth}` })
}

/** Waits until the agent process `pid` has gone. */
export async function expectKilled(app: ElectronApplication, pid: number | undefined): Promise<void> {
  if (pid === undefined) throw new Error('No agent process to watch')
  await expect.poll(() => hooks(app, 'agentPid'), { timeout: 30_000 }).not.toBe(pid)
}

/** Arms the next agent only, keeping main's fake keychain alive across its restart. */
export async function restartArmed(app: ElectronApplication, point: CrashPoint, ageDatabase?: string): Promise<void> {
  const pid = await hooks(app, 'agentPid')
  if (pid === undefined) throw new Error('No agent to restart')
  await app.evaluate(({ utilityProcess }, input) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const fork = utilityProcess.fork
    const probe = { killed: false }
    Object.assign(globalThis, { junoCrashProbe: probe })
    utilityProcess.fork = (modulePath, args, options) => {
      if (options?.serviceName !== 'juno-agent') return fork(modulePath, args, options)
      if (input.ageDatabase !== undefined) {
        const db = new DatabaseSync(input.ageDatabase)
        try { db.prepare('UPDATE incarnations SET created_at = 1 WHERE retired_at IS NULL').run() } finally { db.close() }
      }
      const child = fork(modulePath, args, { ...options, env: { ...process.env, [input.env]: input.point } })
      child.once('exit', (code) => {
        // Restore stages a file and requests an ordinary restart before restore.swapped.
        if (code !== 0) {
          probe.killed = true
          utilityProcess.fork = fork
        }
      })
      return child
    }
    process.kill(input.pid, 'SIGKILL')
  }, { pid, env: CRASH_ENV, point, ageDatabase })
  await expectKilled(app, pid)
}

export async function expectArmedCrash(app: ElectronApplication): Promise<void> {
  await expect.poll(() => app.evaluate(() => {
    const state = globalThis as unknown as { junoCrashProbe: { killed: boolean } }
    return state.junoCrashProbe.killed
  }), { timeout: 30_000 }).toBe(true)
  await agentReady(app)
}

/** The OS folder picker is a boundary fake on both lanes. */
export async function pickFolder(juno: Juno, folder: string): Promise<void> {
  if (juno.surface.kind === 'web') return juno.surface.system('pickFolder', folder)
  await juno.app.evaluate((_electron, path) => {
    const state = globalThis as unknown as { junoTest: { folder: { next: string | null | undefined } } }
    state.junoTest.folder.next = path
  }, folder)
}
