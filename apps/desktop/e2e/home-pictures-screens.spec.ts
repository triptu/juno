// Writes the progress screenshots of Home's picture, its story and the
// gallery (SPEC 12) into docs/progress/. Not part of the suite: run it by hand
// after building the picture files (scripts/pictures/README.md), so the
// screenshots show the real pictures rather than the fake's one stand-in:
//
//   JUNO_SCREENS=1 JUNO_SCREENS_PICTURES=/Volumes/AgentWork/pictures-juno-art pnpm --filter @juno/desktop exec playwright test e2e/home-pictures-screens.spec.ts
import { cp, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SELF_ID, startFakeSlack, TEAM, type Workspace } from '@juno/fake-slack'
import { labelOf } from '@juno/pictures'
import { PICTURES } from '@juno/pictures/catalog'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const progress = resolve(__dirname, '../../../docs/progress')
const files = process.env['JUNO_SCREENS_PICTURES']
const DAY = 24 * 60 * 60 * 1000

test.skip(process.env['JUNO_SCREENS'] !== '1', 'set JUNO_SCREENS=1 to write the progress screenshots')

function quietSeed(workspace: Workspace, avatarBase: string): void {
  const now = workspace.clock.now()
  const people = [['U0LEO', 'Leo Park'], ['U0MAYA', 'Maya Chen'], ['U0ANA', 'Ana Ruiz'], ['U0KAI', 'Kai Sato'], ['U0NOOR', 'Noor Haddad']] as const
  for (const [id, name] of [[SELF_ID, 'Sam Ortiz'], ...people] as const) {
    workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name, image_72: `${avatarBase}/${id}.svg` } })
  }
  const members = new Set([SELF_ID, ...people.map(([id]) => id)])
  // Five of each, so Recent's two columns are full, as on a workspace in use.
  for (const [id, name] of [['C0GEN', 'general'], ['C0ENG', 'eng'], ['C0DES', 'design'], ['C0OPS', 'ops'], ['C0REL', 'releases']] as const) {
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

/** The next caught-up Home shows this picture: its files are on disk (copied in, or from the fake). */
async function nextPicture(win: Page, id: string): Promise<void> {
  const picture = PICTURES.find((entry) => entry.id === id) ?? PICTURES[0]!
  await win.evaluate((label) => localStorage.setItem('juno.homePictures', JSON.stringify({ seen: [label.id], next: label })), labelOf(picture))
}

async function shoot(win: Page, name: string): Promise<void> {
  await win.mouse.move(5, 500)
  await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
  await win.evaluate(() => document.fonts.ready)
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(progress, `${name}.png`) })
}

quiet('Home caught up before and after the picture, the story and the gallery, light and dark', async ({ juno, win, userData }) => {
  test.setTimeout(240_000)
  await mkdir(progress, { recursive: true })
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno

  // Before: the caught-up scene, as Home shows it with no picture on disk.
  await win.evaluate(() => localStorage.setItem('juno.homePictures', JSON.stringify({ off: true, seen: [] })))
  await home.open()
  await shoot(win, 'home-art-before-light')
  await juno.setTheme('Dark')
  await shoot(win, 'home-art-before-dark')
  await juno.setTheme('Light')

  if (files !== undefined) {
    await mkdir(join(userData, 'pictures'), { recursive: true })
    for (const name of await readdir(files)) if (name.endsWith('.webp')) await cp(join(files, name), join(userData, 'pictures', name))
  }

  const homeWith = async (id: string, name: string) => {
    await nextPicture(win, id)
    await juno.openSettings('General')
    await home.open()
    await expect(home.picture.locator('img')).toBeVisible()
    await expect.poll(() => home.picture.locator('img').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await shoot(win, name)
  }
  await homeWith('monet-impression-sunrise', 'home-art-after-light')
  await home.picture.getByRole('button').click()
  await expect(win.locator('[data-picture-page] h1')).toBeVisible()
  await shoot(win, 'home-art-story-light')
  await win.locator('[data-picture-page]').getByRole('button', { name: 'All pictures' }).click()
  await expect(win.locator('[data-gallery]')).toBeVisible()
  await shoot(win, 'home-art-gallery-light')

  // A wider window, as on a laptop screen: the label sits beside the picture.
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await win.locator('[data-gallery-picture]').first().getByRole('button').click()
  await expect(win.locator('[data-picture-page] h1')).toBeVisible()
  await shoot(win, 'home-art-story-wide-light')
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await juno.setTheme('Dark')
  await homeWith('hokusai-great-wave', 'home-art-after-dark')
  await home.picture.getByRole('button').click()
  await expect(win.locator('[data-picture-page] h1')).toBeVisible()
  await shoot(win, 'home-art-story-dark')
  await homeWith('webb-cosmic-cliffs', 'home-art-after-night-dark')
  await home.picture.getByRole('button').click()
  await expect(win.locator('[data-picture-page] h1')).toBeVisible()
  await shoot(win, 'home-art-story-space-dark')
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await expect(win.locator('[data-picture-page] h1')).toBeVisible()
  await shoot(win, 'home-art-story-space-wide-dark')
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))
  await win.locator('[data-picture-page]').getByRole('button', { name: 'All pictures' }).click()
  await expect(win.locator('[data-gallery]')).toBeVisible()
  await shoot(win, 'home-art-gallery-dark')

  // A large window, taller than a laptop screen allows a real one: the same box, the column centred in more room.
  await juno.setTheme('Light')
  await win.setViewportSize({ width: 1728, height: 1080 })
  await homeWith('monet-impression-sunrise', 'home-art-after-large-light')
})
