// Home's picture (SPEC 12, "A picture" and "Pictures and the gallery"): a
// caught-up Home shows a picture that is already on disk, never one that
// would arrive late, with its one-line label and its line and nothing else;
// opening it shows the page with the line, the about, how big or how far
// where that is known, and one link to read more; the gallery shows each
// picture's line under it and switches to an order by time; Settings ›
// General turns it off, and Home shows the scene and "All caught up." with
// nothing under it. Picture files come from the fake Slack's picture store,
// never the network.
import { SELF_ID, startFakeSlack, TEAM, type FakeSlack, type Workspace } from '@juno/fake-slack'
import { pictureYear } from '@juno/pictures'
import { PICTURES } from '@juno/pictures/catalog'
import type { Page } from '@playwright/test'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 150_000 })

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

const quiet = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: quietSeed })
    await use(fake)
    await fake.close()
  },
})

/** Waits until the next picture is on disk, then opens a caught-up Home that shows it, and returns it from the catalog. */
async function homeWithPicture({ juno, win, fake }: { readonly juno: Juno; readonly win: Page; readonly fake: FakeSlack }) {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await home.open()
  await expect(home.greeting).toHaveText('All caught up.')
  // Nothing is on disk yet: the scene and the greeting, with nothing under it, not a picture that would arrive later.
  await expect(home.picture).toHaveCount(0)
  await expect(home.column).toHaveText('All caught up.')
  // When idle, Juno downloads the next picture, both sizes.
  await expect.poll(() => fake.pictureRequests().filter((name) => name.endsWith('-small.webp')).length, { timeout: 30_000 }).toBeGreaterThan(0)
  await expect.poll(() => win.evaluate(() => JSON.parse(localStorage.getItem('juno.homePictures') ?? '{}').next?.id ?? null), { timeout: 30_000 }).not.toBeNull()
  // The next caught-up Home has it in its first frame.
  await juno.openSettings('General')
  await home.open()
  await expect(home.picture).toBeVisible()
  const image = home.picture.locator('img')
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  const id = await win.evaluate(() => JSON.parse(localStorage.getItem('juno.homePictures') ?? '{}').current?.label.id as string)
  return PICTURES.find((entry) => entry.id === id)!
}

quiet('A caught-up Home shows a picture with its label and line, and opens its page with one link to read more', async ({ juno, win, fake }) => {
  const picture = await homeWithPicture({ juno, win, fake })
  const { home } = juno
  // The picture, its label "Title · Artist, date", then its line.
  const image = home.picture.locator('img')
  const label = home.picture.locator('[data-home-caption]')
  await expect(label).toHaveText(`${picture.title} · ${picture.artist}, ${picture.date}`)
  const line = home.picture.locator('[data-picture-line]')
  await expect(line).toHaveText(picture.line.by === undefined ? picture.line.text : `“${picture.line.text}”${picture.line.by}`)
  const [box, under, words] = await Promise.all([image.boundingBox(), label.boundingBox(), line.boundingBox()])
  expect(under!.y).toBeGreaterThan(box!.y + box!.height)
  expect(words!.y).toBeGreaterThan(under!.y + under!.height - 1)
  // The picture leads: even a tall picture with a long line covers more of the page than its label and line together.
  expect(box!.width * box!.height).toBeGreaterThan(under!.width * under!.height + words!.width * words!.height)
  // The picture says Home is caught up: no greeting line, only the picture, its words and a heading for screen readers.
  await expect(home.root.getByRole('heading', { name: 'Home' })).toBeAttached()

  // Clicking it opens the picture page in the tab: the line, the about, no list, and one link, labelled with the institution.
  await home.picture.getByRole('button', { name: `Open ${picture.title}` }).click()
  const page = win.locator('[data-picture-page]')
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
  }
})

quiet('The gallery shows each picture with its line, has no quotes or facts, and orders by time', async ({ juno, win, fake }) => {
  const picture = await homeWithPicture({ juno, win, fake })
  await juno.home.picture.getByRole('button', { name: `Open ${picture.title}` }).click()
  const page = win.locator('[data-picture-page]')
  await page.getByRole('button', { name: 'All pictures' }).click()

  // By kind: every picture in columns with its line under it, the one Home showed ringed, and no Quotes or Facts.
  const gallery = win.locator('[data-gallery]')
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
  const periods = await gallery.locator('section h2').allTextContents()
  expect(periods.length).toBeGreaterThan(3)
  expect(new Set(periods).size).toBe(periods.length)
  const years = (await gallery.locator('[data-gallery-picture]').evaluateAll((tiles) => tiles.map((tile) => (tile as HTMLElement).dataset['galleryPicture']!))).map((id) => pictureYear(PICTURES.find((entry) => entry.id === id)!)!)
  expect(years).toEqual(years.toSorted((a, b) => a - b))
  await expect(gallery.locator('[data-picture-line]')).toHaveCount(0)

  // Back to the picture and forward again: the wall comes back in the order it was left.
  await juno.nav.back()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(picture.title)
  await juno.nav.forward()
  await expect(gallery).toHaveAttribute('data-gallery-order', 'time')
  await gallery.getByRole('radio', { name: 'By kind' }).click()
  await expect(gallery).toHaveAttribute('data-gallery-order', 'kind')
})

quiet('Settings › General turns the picture off, and Home shows its scene', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await home.open()
  // A picture is on disk and ready for the next Home.
  await expect.poll(() => win.evaluate(() => JSON.parse(localStorage.getItem('juno.homePictures') ?? '{}').next?.id ?? null), { timeout: 30_000 }).not.toBeNull()

  await juno.openSettings('General')
  const toggle = juno.settings.root.getByRole('switch', { name: SWITCH })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await home.open()
  await expect(home.greeting).toHaveText('All caught up.')
  await expect(home.picture).toHaveCount(0)
  await expect(home.column).toHaveText('All caught up.')
})
