// Home's picture (SPEC 12, "A picture" and "Pictures and the gallery"): a
// caught-up Home shows a picture that is already on disk, never one that
// would arrive late; opening it shows its story; the gallery lists every
// picture; Settings › General turns it off. Picture files come from the fake
// Slack's picture store, never the network.
import { SELF_ID, startFakeSlack, TEAM, type Workspace } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 150_000 })

const DAY = 24 * 60 * 60 * 1000
const SWITCH = 'Show a picture when you are caught up'

/** Tushar and Leo in #general, everything read: Home is caught up. */
function quietSeed(workspace: Workspace, avatarBase: string): void {
  const now = workspace.clock.now()
  for (const [id, name] of [[SELF_ID, 'Tushar'], ['U0LEO', 'Leo Park']] as const) {
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

quiet('A caught-up Home shows a picture once it is on disk, opens its story, and the gallery lists every picture', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await home.open()
  await expect(home.greeting).toHaveText('All caught up.')
  // Nothing is on disk yet: the scene, not a picture that would arrive later.
  await expect(home.picture).toHaveCount(0)

  // When idle, Juno downloads the next picture, both sizes.
  await expect.poll(() => fake.pictureRequests().filter((name) => name.endsWith('-small.webp')).length, { timeout: 30_000 }).toBeGreaterThan(0)
  await expect.poll(() => win.evaluate(() => JSON.parse(localStorage.getItem('juno.homePictures') ?? '{}').next?.id ?? null), { timeout: 30_000 }).not.toBeNull()

  // The next caught-up Home has it in its first frame, with its plaque under it.
  await juno.openSettings('General')
  await home.open()
  await expect(home.picture).toBeVisible()
  const image = home.picture.locator('img')
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  const plaque = await home.picture.locator('p').textContent()
  const title = plaque!.split(' · ')[0]!
  // The greeting is under the picture.
  const [box, greeting] = await Promise.all([home.picture.boundingBox(), home.greeting.boundingBox()])
  expect(greeting!.y).toBeGreaterThan(box!.y + box!.height)

  // Clicking it opens the picture with its story in the tab.
  await home.picture.getByRole('button', { name: `Open ${title}` }).click()
  const page = win.locator('[data-picture-page]')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  expect(await page.locator('li').count()).toBeGreaterThanOrEqual(3)
  await expect(page.locator('img')).toBeVisible()

  // All pictures opens the gallery, which lists every picture and rings the one Home showed.
  await page.getByRole('button', { name: 'All pictures' }).click()
  const gallery = win.locator('[data-gallery]')
  await expect(gallery.getByRole('heading', { name: 'Gallery' })).toBeVisible()
  expect(await gallery.locator('[data-gallery-picture]').count()).toBeGreaterThan(20)
  await expect(gallery.locator('button[aria-current="true"]')).toHaveCount(1)
  // Back returns to the picture.
  await juno.nav.back()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
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
})
