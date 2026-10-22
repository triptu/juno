// The picture page (SPEC 12, "Pictures and the gallery"): it opens with the
// picture Home showed, the large file replaces the small one only once it is
// decoded, and ← → shows the next picture at once, so the picture never goes
// blank and its box never moves. Every large file is a 2400-pixel image, as
// the real ones are, so it takes as long to decode.
import { SELF_ID, startFakeSlack, TEAM, type FakeSlack, type Workspace } from '@juno/fake-slack'
import type { Page } from '@playwright/test'
import { Juno } from '../driver/juno'
import { launchApp, type RunningApp } from '../fixtures'
import { keepsSize } from './answers'
import { happened, landsAndStays, neverBlank, noFlicker, switchesOnce } from './checks'
import { expect, Feel, test as base, type Scenario } from './feel'
import type { Probe, ProbeFrame } from './recorder'

/** Sam and Leo in #general, everything read: Home is caught up and shows a picture. */
function quietSeed(workspace: Workspace, avatarBase: string): void {
  const now = workspace.clock.now()
  for (const [id, name] of [[SELF_ID, 'Sam Ortiz'], ['U0LEO', 'Leo Park']] as const) {
    workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name, image_72: `${avatarBase}/${id}.svg` } })
  }
  workspace.addConversation({ id: 'C0QUIET', name: 'general', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * 86_400_000, topic: '', purpose: '', isOpen: true, archived: false })
  const last = workspace.post({ channel: 'C0QUIET', user: 'U0LEO', text: 'Release notes are out.', at: now - 60 * 60_000, silent: true })
  workspace.reads.set('C0QUIET', last.ts)
}

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: quietSeed })
    fake.fullSizePictures()
    await use(fake)
    await fake.close()
  },
})

const PAGE = '[data-picture-page]'
const PICTURE = `${PAGE} [data-picture-image]`

const probes: ReadonlyArray<Probe> = [
  { kind: 'count', name: 'page', within: 'main', selector: PAGE },
  { kind: 'count', name: 'home', within: 'main', selector: '[data-home-picture]' },
  { kind: 'box', name: 'box', selector: PICTURE },
  { kind: 'count', name: 'large', within: 'main', selector: `${PICTURE} img[src*="-large.webp"]` },
  { kind: 'text', name: 'title', selector: `${PAGE} h1` },
]
const onPage = { where: (values: ProbeFrame['values']) => Number(values['page']) > 0 }

const opening: Scenario = {
  name: 'picture-open',
  title: "Open Home's picture, then its large file arrives: the page shows the picture in its first frame and it only gets sharper, with no blank frame and no move",
  probes,
  regions: { picture: PICTURE },
  settleMs: 1000,
  checks: [
    happened('the page opened', (r) => r.frames.some((f) => Number(f.values['page']) > 0)),
    happened('the large file showed', (r) => Number(r.frames.at(-1)?.values['large']) > 0),
    switchesOnce("Home to the picture's page", (v) => (Number(v['page']) > 0 ? 'page' : Number(v['home']) > 0 ? 'home' : 'empty'), { from: 'press' }),
    neverBlank('picture', 'the picture', onPage),
    noFlicker('picture', 'the picture', onPage),
    keepsSize('box', 'the picture'),
    landsAndStays('box', 'the picture', { tolerance: 0 }),
  ],
}

const stepping: Scenario = {
  name: 'picture-step',
  title: 'Press → on a picture page twice: each next picture shows in the first frame of its page, never a blank box',
  probes,
  regions: { picture: PICTURE },
  settleMs: 1000,
  checks: [
    happened('the page stepped twice', (r) => new Set(r.frames.map((f) => f.values['title'])).size >= 3),
    neverBlank('picture', 'the picture', onPage),
    switchesOnce('the first step', (v) => String(v['title']), { to: 'second step' }),
  ],
}

/** The first launch downloads Home's next picture with its large file held, so only the small one is on disk; returns its id. */
async function prepareHomePicture({ juno, win, fake, running }: { readonly juno: Juno; readonly win: Page; readonly fake: FakeSlack; readonly running: RunningApp }): Promise<string> {
  fake.holdNext({ method: 'picture:large' })
  await juno.signIn()
  await juno.waitForSync()
  await juno.home.open()
  await expect(juno.home.greeting).toHaveText('All caught up.')
  await expect.poll(() => win.evaluate(() => JSON.parse(localStorage.getItem('juno.homePictures') ?? '{}').next?.id ?? null), { timeout: 30_000 }).not.toBeNull()
  const id = await win.evaluate(() => JSON.parse(localStorage.getItem('juno.homePictures') ?? '{}').next.id as string)
  await running.close()
  fake.release({ method: 'picture:large' })
  return id
}

test('the picture page opens with the picture Home showed, sharpens in one frame, and ← → never shows a blank picture', async ({ juno, win, fake, running, userData, slackApp, studio }) => {
  const id = await prepareHomePicture({ juno, win, fake, running })
  // After a relaunch Home shows the picture, and nothing else has read which files are on disk. Its large file is held again.
  const held = `picture:${id}-large.webp`
  fake.holdNext({ method: held })
  const next = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const again = new Juno(next.app, next.win)
    const feel = new Feel(next.win, studio, 'pictures')
    await again.home.open()
    const image = again.home.picture.locator('img')
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0), { timeout: 30_000 }).toBe(true)
    const page = next.win.locator(PAGE).filter({ visible: true })
    await next.win.waitForTimeout(500)
    await feel.run(opening, async (rec) => {
      await rec.mark('press')
      await again.home.picture.getByRole('button').first().click()
      await expect(page).toBeVisible()
      await expect.poll(() => fake.heldCount({ method: held })).toBe(1)
      await next.win.waitForTimeout(300)
      await rec.mark('large')
      fake.release({ method: held })
      await expect(page.locator('[data-picture-image] img[src*="-large.webp"]')).toHaveCount(1)
    })

    await next.win.waitForTimeout(1000)
    const title = page.getByRole('heading', { level: 1 })
    await feel.run(stepping, async (rec) => {
      const first = await title.textContent()
      await rec.mark('step')
      await next.win.keyboard.press('ArrowRight')
      await expect(title).not.toHaveText(first ?? '')
      await next.win.waitForTimeout(800)
      const second = await title.textContent()
      await rec.mark('second step')
      await next.win.keyboard.press('ArrowRight')
      await expect(title).not.toHaveText(second ?? '')
    })
  } finally {
    await next.close()
  }
})
