// Writes the progress screenshots of Home's picture, its page and the
// gallery (SPEC 12) into docs/progress/ (or JUNO_SCREENS_OUT). Not part of the
// suite: run it by hand after building the picture files
// (scripts/pictures/README.md), so the screenshots show the real pictures
// rather than the fake's one stand-in:
//
//   JUNO_SCREENS=1 JUNO_SCREENS_PICTURES=/Volumes/AgentWork/pictures-juno-art bun run --cwd apps/desktop playwright test e2e/screens/home-pictures-screens.spec.ts
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SELF_ID, startFakeSlack, TEAM, type Workspace } from '@juno/fake-slack'
import { labelOf } from '@juno/pictures'
import { PICTURES } from '@juno/pictures/catalog'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'

const progress = process.env['JUNO_SCREENS_OUT'] ?? resolve(__dirname, '../../../../docs/progress')
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
  // Five of each, as on a workspace in use.
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

/** The first picture with a scale of this kind, for the picture page's shots. */
const scaled = (kind: 'size' | 'distance', prefer: string) => PICTURES.find((entry) => entry.id === prefer && entry.scale?.kind === kind) ?? PICTURES.find((entry) => entry.scale?.kind === kind && entry.kind !== 'space') ?? PICTURES.find((entry) => entry.scale?.kind === kind)

quiet('Home with a picture, the picture page with its scale, and the gallery in both orders, light and dark', async ({ juno, win, userData }) => {
  // Slow: screenshots of every screen, on demand only (JUNO_SCREENS=1).
  test.setTimeout(240_000)
  await mkdir(progress, { recursive: true })
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  if (files !== undefined) {
    await mkdir(join(userData, 'pictures'), { recursive: true })
    for (const name of await readdir(files)) if (name.endsWith('.webp')) await cp(join(files, name), join(userData, 'pictures', name))
  }
  const page = win.locator('[data-picture-page]')
  const gallery = win.locator('[data-gallery]')

  // Where Home's picture, label and line sit in each shot, to measure that the picture leads.
  const boxes: Record<string, unknown> = {}
  const homeWith = async (id: string, name: string) => {
    await nextPicture(win, id)
    await juno.openSettings('General')
    await home.open()
    await expect(home.picture.locator('img')).toBeVisible()
    await expect.poll(() => home.picture.locator('img').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await shoot(win, name)
    const box = (selector: string) => home.picture.locator(selector).first().boundingBox()
    boxes[name] = { picture: await box('img'), label: await box('[data-home-caption] p'), line: await box('[data-picture-line]'), page: await win.evaluate(() => ({ width: innerWidth, height: innerHeight })) }
  }
  // The page in a laptop-sized window, wide enough for the words beside the picture.
  const pageOf = async (id: string, name: string) => {
    await page.getByRole('button', { name: 'All pictures' }).click()
    await gallery.locator(`[data-gallery-picture="${id}"]`).getByRole('button').click()
    await expect(page.locator('h1')).toBeVisible()
    await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await expect.poll(() => page.locator('img').first().evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await shoot(win, name)
    // The column scrolled to its foot: the scale, the link to read more and the credit.
    await page.locator('footer').evaluate((node) => node.scrollIntoView({ block: 'end' }))
    await shoot(win, `${name}-foot`)
    await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))
  }
  const size = scaled('size', 'monet-impression-sunrise')
  const distance = scaled('distance', 'webb-cosmic-cliffs')

  await homeWith('monet-impression-sunrise', 'pictures-a-home-painting-light')
  await home.picture.getByRole('button').click()
  await expect(page.locator('h1')).toBeVisible()
  if (size !== undefined) await pageOf(size.id, 'pictures-a-page-size-light')
  await page.getByRole('button', { name: 'All pictures' }).click()
  await expect(gallery).toBeVisible()
  await shoot(win, 'pictures-a-gallery-kind-light')
  await gallery.getByRole('radio', { name: 'By time' }).click()
  await shoot(win, 'pictures-a-gallery-time-light')
  // A large laptop window: more centuries side by side, or more pictures to a row.
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000))
  await shoot(win, 'pictures-a-gallery-time-wide-light')
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))
  await gallery.getByRole('radio', { name: 'By kind' }).click()

  await juno.setTheme('Dark')
  await homeWith('voyager1-pale-blue-dot', 'pictures-a-home-space-dark')
  await home.picture.getByRole('button').click()
  await expect(page.locator('h1')).toBeVisible()
  if (distance !== undefined) await pageOf(distance.id, 'pictures-a-page-distance-dark')
  await page.getByRole('button', { name: 'All pictures' }).click()
  await expect(gallery).toBeVisible()
  await shoot(win, 'pictures-a-gallery-kind-dark')
  await gallery.getByRole('radio', { name: 'By time' }).click()
  await shoot(win, 'pictures-a-gallery-time-dark')
  await gallery.getByRole('radio', { name: 'By kind' }).click()
  await homeWith('monet-impression-sunrise', 'pictures-a-home-painting-dark')
  await juno.setTheme('Light')
  await homeWith('voyager1-pale-blue-dot', 'pictures-a-home-space-light')
  await writeFile(join(progress, 'pictures-a-home-boxes.json'), JSON.stringify(boxes, null, 2))
})
