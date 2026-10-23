// Screenshots of Home's states (SPEC 12) for a layout review: rows, caught up
// with a picture and with the scene, the first sync's line and the welcome
// card, light and dark, at 1200×800 and in a large window. Not part of the
// suite: run it by hand, and copy the shots worth keeping into docs/progress/.
//
//   JUNO_SCREENS=1 JUNO_SCREENS_OUT=<dir> JUNO_SCREENS_PICTURES=/Volumes/AgentWork/pictures-juno-art bun run --cwd apps/desktop playwright test e2e/home-screens.spec.ts
import { cp, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SELF_ID, startFakeSlack, TEAM, type Workspace } from '@juno/fake-slack'
import { labelOf } from '@juno/pictures'
import { PICTURES } from '@juno/pictures/catalog'
import type { Page } from '@playwright/test'
import type { Juno } from './driver/juno'
import { expect, launchApp, syncedTest, test } from './fixtures'

const out = process.env['JUNO_SCREENS_OUT'] ?? ''
const files = process.env['JUNO_SCREENS_PICTURES']
const DAY = 24 * 60 * 60 * 1000
/** 1200×800, and 1600×1000 or as much of it as the screen allows. */
const SIZES = { '1200x800': [1200, 800], large: [1600, 1000] } as const

test.skip(process.env['JUNO_SCREENS'] !== '1' || out === '', 'set JUNO_SCREENS=1 and JUNO_SCREENS_OUT to write the screenshots')
test.describe.configure({ timeout: 240_000 })

/** Everything read: Home is caught up. */
function quietSeed(workspace: Workspace, avatarBase: string): void {
  const now = workspace.clock.now()
  const people = [['U0LEO', 'Leo Park'], ['U0MAYA', 'Maya Chen'], ['U0ANA', 'Ana Ruiz']] as const
  for (const [id, name] of [[SELF_ID, 'Sam Ortiz'], ...people] as const) {
    workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name, image_72: `${avatarBase}/${id}.svg` } })
  }
  const members = new Set([SELF_ID, ...people.map(([id]) => id)])
  for (const [id, name] of [['C0GEN', 'general'], ['C0ENG', 'eng'], ['C0DES', 'design']] as const) {
    workspace.addConversation({ id, name, kind: 'public', members, created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
    const last = workspace.post({ channel: id, user: 'U0LEO', text: 'Notes are in the doc.', at: now - 2 * 60 * 60_000, silent: true })
    workspace.reads.set(id, last.ts)
  }
  for (const [user] of people) {
    const id = `D${user.slice(1)}`
    workspace.addConversation({ id, name: '', kind: 'im', members: new Set([SELF_ID, user]), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
    const last = workspace.post({ channel: id, user, text: 'Thanks, that works.', at: now - 3 * 60 * 60_000, silent: true })
    workspace.reads.set(id, last.ts)
  }
}

const quiet = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: quietSeed })
    await use(fake)
    await fake.close()
  },
})

async function shoot(win: Page, name: string): Promise<void> {
  await win.mouse.move(5, 500)
  await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
  await win.evaluate(() => document.fonts.ready)
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(out, `${name}.png`) })
}

/** Shoots the page in each size and theme, `prepare` run again after each change so Home is shown afresh. */
async function shootAll(juno: Juno, name: string, prepare: () => Promise<unknown>): Promise<void> {
  for (const theme of ['Light', 'Dark'] as const) {
    await juno.setTheme(theme)
    for (const [size, [width, height]] of Object.entries(SIZES)) {
      await juno.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), [width, height])
      await prepare()
      await shoot(juno.win, `home-${name}-${size}-${theme.toLowerCase()}`)
    }
  }
  await juno.setTheme('Light')
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))
}

/** Away from Home and back, so it reads its items and its picture afresh. */
async function reopen(juno: Juno): Promise<void> {
  await juno.openSettings('General')
  await juno.home.open()
}

syncedTest('rows', async ({ juno }) => {
  await mkdir(out, { recursive: true })
  await shootAll(juno, 'rows', async () => {
    await reopen(juno)
    await expect(juno.home.root.locator('[data-home-item]').first()).toBeVisible()
  })
})

quiet('caught up with the scene and with a picture', async ({ juno, win, userData }) => {
  await mkdir(out, { recursive: true })
  await juno.signIn()
  await juno.waitForSync()
  await win.evaluate(() => localStorage.setItem('juno.homePictures', JSON.stringify({ off: true, seen: [] })))
  await shootAll(juno, 'scene', () => reopen(juno))

  if (files !== undefined) {
    await mkdir(join(userData, 'pictures'), { recursive: true })
    for (const name of await readdir(files)) if (name.endsWith('.webp')) await cp(join(files, name), join(userData, 'pictures', name))
  }
  const picture = PICTURES.find((entry) => entry.id === 'monet-impression-sunrise') ?? PICTURES[0]!
  await shootAll(juno, 'picture', async () => {
    await win.evaluate((label) => localStorage.setItem('juno.homePictures', JSON.stringify({ seen: [label.id], next: label })), labelOf(picture))
    await reopen(juno)
    await expect.poll(() => juno.home.picture.locator('img').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  })
})

test('the first sync line', async ({ juno, win, fake }) => {
  await mkdir(out, { recursive: true })
  fake.holdNext({ method: 'subscriptions.thread.getView' })
  await juno.signIn()
  await expect.poll(() => fake.heldCount({ method: 'subscriptions.thread.getView' })).toBe(1)
  const loading = win.locator('[data-home][data-home-loading]')
  await expect(loading).toBeVisible()
  await shootAll(juno, 'first-sync', () => expect(loading).toBeVisible())
  fake.release()
})

/** An app that shows the welcome card by itself, as outside tests. */
const welcomed = test.extend({
  running: async ({ fake, slackApp, userData }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true })
    await use(running)
    await running.close()
  },
})

welcomed('the welcome card', async ({ juno }) => {
  await mkdir(out, { recursive: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.welcome.expectShown()
  await shootAll(juno, 'welcome', () => juno.welcome.expectShown())
})
