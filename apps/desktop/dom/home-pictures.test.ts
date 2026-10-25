// Home's picture (SPEC 12, "A picture" and "Pictures and the gallery"): a
// caught-up Home shows a picture that is already on disk, never one that
// would arrive late, with its one-line label and its line and nothing else;
// opening it shows the page with the line, the about, how big or how far
// where that is known, and one link to read more; the gallery shows each
// picture's line under it and switches to an order by time; Settings ›
// General turns it off, and Home shows the scene and "All caught up." with
// nothing under it. Picture files come from the fake Slack's picture store,
// never the network. Where the label and line sit under the picture is the
// gallery's; which heading shows is CSS, so the column's text stands for it.
import { SELF_ID, TEAM, type FakeSlack, type Workspace } from '@juno/fake-slack'
import { pictureYear } from '@juno/pictures'
import { PICTURES } from '@juno/pictures/catalog'
import type { DomApp } from './app'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const DAY = 24 * 60 * 60 * 1000
const SWITCH = 'Show a picture when you are caught up'

/** Sam and Leo in #general, everything read: Home is caught up. */
function quietSeed(workspace: Workspace, avatarBase: string): void {
  const now = workspace.clock.now()
  for (const [id, name] of [[SELF_ID, 'Sam Ortiz'], ['U0LEO', 'Leo Park']] as const) {
    workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name, image_72: `${avatarBase}/${id}.svg` } })
  }
  workspace.addConversation({ id: 'C0QUIET', name: 'general', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
  const last = workspace.post({ channel: 'C0QUIET', user: 'U0LEO', text: 'Release notes are out.', at: now - 60 * 60_000, silent: true })
  workspace.reads.set('C0QUIET', last.ts)
}

const stored = (app: DomApp) => JSON.parse(app.window.localStorage.getItem('juno.homePictures') ?? '{}') as { next?: { id?: string }; current?: { label: { id: string } } }

/** Waits until the next picture is on disk, then opens a caught-up Home that shows it, and returns it from the catalog. */
async function homeWithPicture({ juno, app, fake }: { readonly juno: Juno; readonly app: DomApp; readonly fake: FakeSlack }) {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await home.open()
  // Nothing is on disk yet: the scene and the greeting, with nothing under it, not a picture that would arrive later.
  await expect(home.picture).toHaveCount(0)
  await expect(home.column).toHaveText('All caught up.')
  expect(await home.kinds()).toEqual([])
  await expect(home.root.getByRole('button', { name: 'Browse all topics' })).toHaveCount(0)
  // When idle, Juno downloads the next picture, both sizes.
  await expect.poll(() => fake.pictureRequests().filter((name) => name.endsWith('-small.webp')).length, { timeout: 30_000 }).toBeGreaterThan(0)
  await expect.poll(() => stored(app).next?.id ?? null, { timeout: 30_000 }).toBeTruthy()
  // The next caught-up Home has it in its first frame.
  await juno.openSettings('General')
  await home.open()
  await expect(home.picture).toBeVisible()
  await expect(home.picture.locator('img')).toBeVisible()
  const id = stored(app).current?.label.id
  return PICTURES.find((entry) => entry.id === id)!
}

domTest('A caught-up Home shows a picture with its label and line, opens its page and the gallery, and Settings › General turns it off', async ({ juno, app, fake, step }) => {
  const picture = await homeWithPicture({ juno, app, fake })
  const shown = await step('the picture shows with its label and line, and opens its page with one link to read more', () => pictureAndPage(juno, picture))
  await step('the gallery shows each picture with its line, has no quotes or facts, and orders by time', () => gallery(juno, picture, shown))
  await step('Settings › General turns the picture off, and Home shows its scene', () => turnOff(juno))
}, { synced: false, seed: quietSeed, timeout: 150_000 })

type Picture = (typeof PICTURES)[number]

/** Returns the picture whose page was opened last, which Back from the gallery returns to. */
async function pictureAndPage(juno: Juno, picture: Picture): Promise<Picture> {
  const { home, win } = juno
  const page = win.locator('[data-picture-page]')
  let shown = picture
  // The picture, its label "Title · Artist, date", then its line.
  const label = home.picture.locator('[data-home-caption]')
  await expect(label).toHaveText(`${picture.title} · ${picture.artist}, ${picture.date}`)
  const line = home.picture.locator('[data-picture-line]')
  await expect(line).toHaveText(picture.line.by === undefined ? picture.line.text : `“${picture.line.text}”${picture.line.by}`)
  // The picture says Home is caught up: no greeting line, only the picture, its words and a heading for screen readers.
  await expect(home.root.getByRole('heading', { name: 'Home' })).toBeAttached()

  // Clicking it opens the picture page in the tab: the line, the about, no list, and one link, labelled with the institution.
  await home.picture.getByRole('button', { name: `Open ${picture.title}` }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(picture.title)
  await expect(page.locator('[data-picture-page-line]')).toContainText(picture.line.text)
  await expect(page.getByText(picture.about)).toBeVisible()
  await expect(page.locator('li')).toHaveCount(0)
  const links = page.getByRole('link')
  await expect(links).toHaveCount(1)
  await expect(links).toHaveText(picture.learnMore.label)
  await expect(links).toHaveAttribute('href', picture.learnMore.url)
  await expect(page.locator('footer p')).toHaveText(picture.credit)
  await expect(page.locator('[data-picture-scale]')).toHaveCount(picture.scale === undefined ? 0 : 1)

  // A picture with its size shows it beside a person; a space image shows how far.
  for (const kind of ['size', 'distance'] as const) {
    const scaled = PICTURES.find((entry) => entry.scale?.kind === kind)
    if (scaled === undefined) continue
    await page.getByRole('button', { name: 'All pictures' }).click()
    await win.locator(`[data-gallery-picture="${scaled.id}"]`).getByRole('button').click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(scaled.title)
    await expect(page.locator(`[data-picture-scale="${kind}"]`)).toBeVisible()
    shown = scaled
  }
  return shown
}

async function gallery(juno: Juno, picture: Picture, shown: Picture): Promise<void> {
  const { win } = juno
  const page = win.locator('[data-picture-page]')
  const gallery = win.locator('[data-gallery]')
  await page.getByRole('button', { name: 'All pictures' }).click()

  // By kind: every picture in columns with its line under it, the one Home showed ringed, and no Quotes or Facts.
  await expect(gallery.getByRole('heading', { name: 'Gallery' })).toBeVisible()
  await expect(gallery.locator('[data-gallery-picture]')).toHaveCount(PICTURES.length)
  await expect(gallery.locator('[data-picture-line]')).toHaveCount(PICTURES.length)
  await expect(gallery.locator(`[data-gallery-picture="${picture.id}"] [data-picture-line]`)).toContainText(picture.line.text)
  await expect(gallery.locator('button[aria-current="true"]')).toHaveCount(1)
  await expect(gallery.getByRole('button', { name: /^(Quotes|Facts)\b/ })).toHaveCount(0)

  // By time: sections by period, oldest first, BCE included, each picture with its date and no line.
  await gallery.getByRole('radio', { name: 'By time' }).click()
  await expect(gallery).toHaveAttribute('data-gallery-order', 'time')
  await expect(gallery.locator('[data-gallery-picture]')).toHaveCount(PICTURES.length)
  const periods = gallery.locator('section h2').allTextContents()
  expect(periods.length).toBeGreaterThan(3)
  expect(new Set(periods).size).toBe(periods.length)
  const years = gallery.locator('[data-gallery-picture]').all().map((tile) => pictureYear(PICTURES.find((entry) => entry.id === tile.dataset['galleryPicture'])!)!)
  expect(years).toEqual(years.toSorted((a, b) => a - b))
  await expect(gallery.locator('[data-picture-line]')).toHaveCount(0)

  // Back to the picture and forward again: the wall comes back in the order it was left.
  await juno.nav.back()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shown.title)
  await juno.nav.forward()
  await expect(gallery).toHaveAttribute('data-gallery-order', 'time')
  await gallery.getByRole('radio', { name: 'By kind' }).click()
  await expect(gallery).toHaveAttribute('data-gallery-order', 'kind')
}

async function turnOff(juno: Juno): Promise<void> {
  const { home } = juno
  await juno.openSettings('General')
  const toggle = juno.settings.root.getByRole('switch', { name: SWITCH })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await home.open()
  await expect(home.picture).toHaveCount(0)
  await expect(home.column).toHaveText('All caught up.')
  expect(await home.kinds()).toEqual([])
  await expect(home.root.getByRole('button', { name: 'Browse all topics' })).toHaveCount(0)
}
