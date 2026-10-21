/**
 * The first-run design-review harness: walks the built app as a new user
 * does, against the fake Slack (and a fake OpenRouter for Juno). Sign-in and
 * the Slack-app import, the first sync, the first Home, All topics, topic
 * and ⌘K, Juno with no provider and its setup, the empty states, and AI
 * assist off. Writes each shot in light and dark to ../<REVIEW_SET>/, and
 * boxes and timings to ./out-<REVIEW_SET>/. Review tooling only; it asserts
 * nothing about the product.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { Juno } from '../../../../../apps/desktop/e2e/driver/juno'
import { expect, hooks, launchApp, tempUserData, test as base, writeSlackApp } from '../../../../../apps/desktop/e2e/fixtures'
import { answer, JunoChatPane } from '../../../../../apps/desktop/e2e/juno-agent/chat'

const SET = process.env.REVIEW_SET ?? 'before'
const ONLY = process.env.REVIEW_ONLY
const shots = resolve(__dirname, '..', SET)
const out = resolve(__dirname, `out-${SET}`)
mkdirSync(shots, { recursive: true })
mkdirSync(out, { recursive: true })

const log: string[] = []
const save = (name: string, data: unknown) => writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2))
const flushLog = (name: string) => writeFileSync(join(out, `${name}.log.md`), log.join('\n') + '\n')

const settle = async (win: Page, ms = 300) => {
  await win.evaluate(() => document.fonts.ready)
  await win.waitForTimeout(ms)
}

const setSize = (app: ElectronApplication, width: number, height: number) =>
  app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height)
  }, { width, height })

/** The page (or a box around `clip`) in light, then dark. */
async function both(win: Page, name: string, clip?: Locator) {
  for (const theme of ['light', 'dark'] as const) {
    await win.emulateMedia({ colorScheme: theme })
    await settle(win)
    const path = join(shots, `${name}-${theme}.png`)
    const box = clip === undefined ? null : await clip.boundingBox()
    if (box) {
      const pad = 24
      await win.screenshot({ path, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } })
    } else {
      await win.screenshot({ path })
    }
  }
  await win.emulateMedia({ colorScheme: 'light' })
  await settle(win, 150)
  log.push(`- shot ${name}`)
}

/** One shot in the current theme, for time series. */
async function one(win: Page, name: string) {
  await win.screenshot({ path: join(shots, `${name}.png`) })
  log.push(`- shot ${name}`)
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (error) {
    log.push(`- FAILED ${name}: ${String(error).split('\n')[0]}`)
  }
}

const measure = (win: Page, selector: string) =>
  win.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 60),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        padding: s.padding,
        margin: s.margin,
        font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`,
        color: s.color,
      }
    }),
  selector)

/** What the window says while it runs: the sidebar rows, the workspace text, the engine line. */
const snapshot = (win: Page) =>
  win.evaluate(() => ({
    rows: document.querySelectorAll('[data-topic-row], [role=listbox] [role=option]').length,
    sidebar: (document.querySelector('nav[aria-label], aside')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
    main: (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
  }))

const only = (name: string) => ONLY === undefined || ONLY.split(',').includes(name)

base.describe.configure({ timeout: 600_000 })

base('01 sign in and first sync', async ({ juno, fake }) => {
  base.skip(!only('signin'))
  log.length = 0
  const { win, app } = juno
  await setSize(app, 1400, 900)
  await settle(win, 800)

  await step('sign-in page', async () => {
    await expect(win.getByRole('heading', { name: "Hi, I'm Juno" })).toBeVisible({ timeout: 20_000 })
    await both(win, '01-sign-in')
    save('measure-sign-in', await measure(win, 'section[aria-labelledby=sign-in-title], section[aria-labelledby=sign-in-title] *'))
    await setSize(app, 720, 600)
    await both(win, '01b-sign-in-720')
    await setSize(app, 1400, 900)
  })

  await step('import the Slack app’s session', async () => {
    fake.holdNext({ method: 'client.userBoot', before: true })
    await juno.importFromSlackApp({ skipSetUp: false })
  })

  await step('before the first boot answers', async () => {
    await win.waitForTimeout(1_500)
    await both(win, '03-signed-in-boot-held')
    save('snapshot-boot-held', await snapshot(win))
    await juno.accountMenu.open()
    await both(win, '03b-account-menu-boot-held')
    await juno.accountMenu.close()
  })

  await step('history held', async () => {
    fake.holdNext({ method: 'conversations.history', times: 1000 })
    fake.release({ method: 'client.userBoot' })
    await win.waitForTimeout(2_000)
    await both(win, '04-history-held')
    save('snapshot-history-held', await snapshot(win))
    fake.release({ method: 'conversations.history' })
  })

  await step('to live', async () => {
    const started = Date.now()
    const series = []
    for (let i = 0; i < 12; i++) {
      series.push({ at: Date.now() - started, engine: await hooks(app, 'engineState'), ...(await snapshot(win)) })
      await one(win, `05-sync-${String(i).padStart(2, '0')}`)
      await win.waitForTimeout(250)
    }
    save('series-small', series)
    await juno.waitForSync()
    await win.mouse.move(1300, 880)
    await both(win, '06-first-home')
  })
  flushLog('01-sign-in')
})

base('02 import from the Slack app', async ({ juno }) => {
  base.skip(!only('import'))
  log.length = 0
  const { win, app } = juno
  await setSize(app, 1400, 900)
  await step('import', async () => {
    await expect(win.getByRole('heading', { name: "Hi, I'm Juno" })).toBeVisible({ timeout: 20_000 })
    await juno.importButton.hover()
    await both(win, '07-sign-in-import-hover', win.locator('section[aria-labelledby=sign-in-title]'))
    await juno.importFromSlackApp()
    await one(win, '07b-import-0')
    await win.waitForTimeout(400)
    await one(win, '07c-import-400')
    await juno.waitForSync()
    await both(win, '08-after-import')
  })
  flushLog('02-import')
})

base('03 a long cold boot', async () => {
  base.skip(!only('cold'))
  log.length = 0
  const fake = await startFakeSlack({ seed: largeSeed({ topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } }) })
  const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
  const slackApp = await writeSlackApp(fake, dir)
  const userData = await tempUserData()
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const juno = new Juno(running.app, running.win)
    const { win, app } = juno
    await setSize(app, 1400, 900)
    await expect(win.getByRole('heading', { name: "Hi, I'm Juno" })).toBeVisible({ timeout: 20_000 })
    await juno.importFromSlackApp()
    const started = Date.now()
    const series = []
    for (let i = 0; Date.now() - started < 90_000; i++) {
      const engine = await hooks(app, 'engineState')
      series.push({ at: Date.now() - started, engine, ...(await snapshot(win)) })
      if (i % 4 === 0) await one(win, `09-cold-${String(i).padStart(3, '0')}`)
      if (engine === 'live') break
      await win.waitForTimeout(500)
    }
    save('series-cold', series)
    await win.waitForTimeout(1_000)
    await both(win, '09z-cold-live')
  } finally {
    await running.close()
    await fake.close()
    await rm(dir, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
  flushLog('03-cold')
})

base('04 first pages and empty states', async ({ juno }) => {
  base.skip(!only('pages'))
  log.length = 0
  const { win, app, palette, sidebar } = juno
  await setSize(app, 1400, 900)
  await juno.signIn()
  await juno.waitForSync()
  await win.mouse.move(1300, 880)

  await step('home', async () => {
    await both(win, '10-home')
    save('measure-home', await measure(win, 'main h1, main h2, main [role=button], main button, main li'))
    await setSize(app, 720, 600)
    await both(win, '10b-home-720')
    await setSize(app, 1400, 900)
  })

  await step('all topics', async () => {
    await juno.allTopics.open()
    await settle(win, 800)
    await both(win, '11-all-topics')
    await juno.allTopics.search.fill('zebra crossing quartz')
    await settle(win, 600)
    await both(win, '11b-all-topics-no-match')
    await juno.allTopics.search.fill('')
  })

  await step('first topic', async () => {
    await sidebar.rows.first().click()
    await settle(win, 1200)
    await win.mouse.move(1300, 880)
    await both(win, '12-first-topic')
  })

  await step('palette', async () => {
    await palette.open()
    await palette.expectResults()
    await both(win, '13-palette-first')
    await palette.type('zebra crossing quartz')
    await win.waitForTimeout(1500)
    await both(win, '13b-palette-no-matches', palette.root)
    await palette.press('Escape')
  })

  await step('sidebar unread only', async () => {
    await sidebar.toggleUnread()
    await settle(win, 600)
    await both(win, '14-unread-only', win.locator('aside').first())
    await sidebar.toggleUnread()
  })

  await step('empty view', async () => {
    await sidebar.createView({ name: 'Quiet' })
    await settle(win, 800)
    await both(win, '15-empty-view', win.locator('aside').first())
  })

  await step('automated', async () => {
    save('pills', await measure(win, '[aria-label="Filters"] button, [role=tablist] button'))
  })

  await step('notifications', async () => {
    await juno.openNotifications()
    await settle(win, 800)
    await both(win, '16-notifications')
  })

  await step('preferences', async () => {
    await juno.openPreferences()
    await settle(win, 800)
    await both(win, '17-preferences')
    await win.locator('main').evaluate((el) => el.querySelector('[data-scroll], [style*=overflow]')?.scrollBy(0, 2000))
    await win.mouse.move(900, 500)
    await win.mouse.wheel(0, 3000)
    await settle(win, 400)
    await both(win, '17b-preferences-ignored')
  })
  flushLog('04-pages')
})

/** The app with no provider set up, and a fake OpenRouter to set up. */
const setup = base.extend<{ readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  running: async ({ fake, slackApp, userData, model }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, fakeOpenRouterUrl: model.origin })
    await use(running)
    await running.close()
  },
})

const KEY = 'sk-or-v1-e2e0123456789abcdef0123456789abcdef'
const junoNav = (win: Page) => win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

async function openJunoPage(juno: Juno, label: string): Promise<void> {
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: label }).click()
  await juno.tabs.expectActive(label)
}

setup('05 Juno with no provider, then setup and the first chat', async ({ juno }) => {
  base.skip(!only('juno'))
  log.length = 0
  const { win, app, sidebar } = juno
  await setSize(app, 1400, 900)
  await juno.signIn()
  await juno.waitForSync()
  await win.mouse.move(1300, 880)

  await step('no provider tab', async () => {
    await junoNav(win).click()
    await expect(win.locator('main [data-juno-no-provider]')).toBeVisible()
    await settle(win, 600)
    await both(win, '20-juno-needs-a-model')
    save('measure-no-provider', await measure(win, 'main [data-juno-no-provider], main [data-juno-no-provider] *'))
  })

  await step('no provider panel', async () => {
    await sidebar.rows.first().click()
    await settle(win, 800)
    await juno.tabs.menu('juno')
    await settle(win, 600)
    await win.mouse.move(1300, 880)
    await both(win, '21-panel-needs-a-model')
    await juno.tabs.menu('juno')
  })

  await step('add a provider', async () => {
    await junoNav(win).click()
    await win.locator('main [data-juno-no-provider]').getByRole('button', { name: 'Add a provider' }).click()
    await juno.tabs.expectActive('Settings › Juno')
    await settle(win, 600)
    await both(win, '22-settings-provider')
    const page = win.locator('main')
    await page.getByLabel('API key').fill('two words')
    await page.getByRole('button', { name: 'Save' }).click()
    await settle(win, 400)
    await both(win, '22b-settings-key-error')
    await page.getByLabel('API key').fill(KEY)
    await page.getByRole('button', { name: 'Save' }).click()
    const started = Date.now()
    await one(win, '23-after-save-0')
    await win.waitForTimeout(500)
    await one(win, '23-after-save-500')
    await expect(page.getByRole('heading', { name: 'Model' })).toBeVisible({ timeout: 20_000 })
    save('timing-model-section', { ms: Date.now() - started })
    await settle(win, 600)
    await both(win, '23b-settings-with-model')
    await win.mouse.wheel(0, 600)
    await settle(win, 400)
    await both(win, '23c-settings-scrolled')
  })

  await step('choose a model', async () => {
    const page = win.locator('main')
    const select = page.getByLabel('Chat model').or(page.getByRole('combobox').first())
    save('model-options', await select.first().evaluate((el) => (el instanceof HTMLSelectElement ? [...el.options].map((o) => o.text) : el.outerHTML.slice(0, 400))))
  })

  await step('empty chat', async () => {
    await junoNav(win).click()
    await settle(win, 1000)
    await both(win, '24-juno-empty-chat')
  })

  await step('juno pages empty', async () => {
    for (const [name, label] of [['25-activity-empty', 'Activity'], ['25b-scheduled-empty', 'Scheduled'], ['25c-remembers-empty', 'What Juno remembers'], ['25d-memory-empty', 'Memory of this chat'], ['25e-connections', 'Connections']] as const) {
      await junoNav(win).click()
      await openJunoPage(juno, label)
      await settle(win, 800)
      await both(win, name)
    }
  })

  await step('first chat', async () => {
    await junoNav(win).click()
    const chat = JunoChatPane.tab(win)
    await chat.send('what is on today?')
    await one(win, '26-first-chat-sent')
    await chat.expectJuno('You said: what is on today?')
    await settle(win, 600)
    await both(win, '26b-first-chat-answer')
  })
  flushLog('05-juno')
})

base('06 AI assist off from the start', async ({ juno, fake, slackApp, userData, running }) => {
  base.skip(!only('aioff'))
  log.length = 0
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
  db.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const off = new Juno(again.app, again.win)
    const { win, app } = off
    await setSize(app, 1400, 900)
    await expect(off.home.greeting).toBeVisible({ timeout: 30_000 })
    await win.mouse.move(1300, 880)
    await step('home', () => both(win, '30-ai-off-home'))
    await step('juno tab', async () => {
      await junoNav(win).click().catch(() => undefined)
      await settle(win, 800)
      await both(win, '31-ai-off-juno')
    })
    await step('topic', async () => {
      await off.sidebar.rows.first().click()
      await settle(win, 1000)
      await win.mouse.move(1300, 880)
      await both(win, '32-ai-off-topic')
    })
    await step('account menu', async () => {
      await off.accountMenu.open()
      await both(win, '33-ai-off-account-menu')
      await off.accountMenu.close()
    })
    await step('palette', async () => {
      await off.palette.open()
      await off.palette.type('tell maya the slot works')
      await win.waitForTimeout(1200)
      await both(win, '34-ai-off-palette', off.palette.root)
      await off.palette.press('Escape')
    })
    await step('notifications', async () => {
      await off.openNotifications()
      await settle(win, 800)
      await both(win, '35-ai-off-notifications')
    })
  } finally {
    await again.close()
  }
  flushLog('06-ai-off')
})

setup('07 Set up Juno after sign-in', async ({ juno }) => {
  base.skip(!only('setup'))
  log.length = 0
  const { win, app } = juno
  await setSize(app, 1400, 900)
  await juno.signIn({ skipSetUp: false })
  const { setUp } = juno
  await step('set up', async () => {
    await expect(setUp.getByRole('heading', { name: 'Set up Juno' })).toBeVisible({ timeout: 15_000 })
    await win.mouse.move(1300, 880)
    await both(win, '40-set-up')
    save('measure-set-up', await measure(win, '[data-set-up-juno], [data-set-up-juno] :is(h1, p, button, input, select, [role=radiogroup])'))
    await setSize(app, 720, 600)
    await both(win, '40b-set-up-720')
    await setSize(app, 1400, 900)
    await setUp.getByRole('radio', { name: 'OpenAI-compatible' }).click()
    await both(win, '41-set-up-custom')
    await setUp.getByRole('radio', { name: 'OpenRouter' }).click()
    await setUp.getByLabel('API key').fill('two words')
    await setUp.getByRole('button', { name: 'Continue' }).click()
    await both(win, '42-set-up-bad-key')
    await setUp.getByLabel('API key').fill(KEY)
    await setUp.getByRole('button', { name: 'Continue' }).click()
    await one(win, '43-set-up-saving')
    await expect(setUp.locator('[data-set-up-model] select')).toBeVisible({ timeout: 20_000 })
    await win.mouse.move(1300, 880)
    await both(win, '44-set-up-model')
    await setUp.getByRole('button', { name: 'Continue' }).click()
    await juno.waitForSync()
    await win.mouse.move(1300, 880)
    await both(win, '45-after-set-up')
  })
  flushLog('07-set-up')
})
