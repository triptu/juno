// Formatting in the composer (spec section 8), what needs a browser: a send
// while the formatting chunk is still loading, or fails to load. ⌘B and ⌘Z
// and mixed-direction lines are in composer.spec.ts; markup sent as
// rich_text, and ⌘B and ⌘I around picked mentions and linked words, are in
// the DOM lane (`dom/formatting.test.ts`).
import { expect, test } from './fixtures'
import { readUserDb } from './driver/userDb'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

type Json = Record<string, unknown>

/**
 * The `rich_text` elements and the `text` of the last `chat.postMessage`.
 * The call goes as multipart form data, which writes a line break in a
 * field as CRLF, as Slack's own client's calls do.
 */
function lastPost(calls: ReadonlyArray<{ method: string; args: Json }>): { readonly elements: unknown; readonly text: unknown } {
  const posted = calls.filter((call) => call.method === 'chat.postMessage').at(-1)
  const blocks: unknown = typeof posted?.args['blocks'] === 'string' ? JSON.parse(posted.args['blocks']) : posted?.args['blocks']
  return { elements: (blocks as ReadonlyArray<{ elements: unknown }> | undefined)?.[0]?.elements, text: String(posted?.args['text']).replace(/\r\n/g, '\n') }
}

// A send while the chunk loads, and while it fails to load. What else the user does while it loads (a selection,
// focus, composition, ⌘B twice, ⌃B on a Mac, the bidi fallback) are rare races at first use and are not tested.
const COLD_ACTIONS = ['send', 'failed-send'] as const

const posts = (fake: { readonly calls: ReadonlyArray<{ readonly method: string }> }) => fake.calls.filter((call) => call.method === 'chat.postMessage').length

// Each step reloads the page with the formatting chunk held, so the step's keys land before the grammar loads.
test('a send while the formatting chunk loads, or fails to load, goes once with its formatting', async ({ juno, fake, userData }) => {
  const drafts = () => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT COUNT(*) AS n FROM drafts').get()?.['n'])
  const draftsAtStart = drafts()
  for (const action of COLD_ACTIONS) {
    await test.step(`a send while the formatting chunk ${action === 'send' ? 'loads' : 'fails to load'}`, async () => {
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      // Each step posts its own word, so its message is the only one with it.
      const word = action === 'send' ? 'bold' : 'emphatic'
      await juno.win.route(/\/markupRules-[^/]+\.js/, async (route) => { if (action === 'failed-send') return route.abort(); await held; await route.continue() })
      try {
        await juno.win.reload({ waitUntil: 'domcontentloaded' })
        await juno.waitForSync()
        await juno.sidebar.row(POSTGRES).open()
        const field = juno.topic.composer
        const before = posts(fake)
        await field.fill(`*${word}*`)
        await field.press('Enter')
        await expect.poll(() => posts(fake)).toBe(before + 1)
        await field.fill('next draft')
        release()
        await juno.topic.expectSent(word)
        await expect(field).toHaveValue('next draft')
        expect(lastPost(fake.calls).elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: word, style: { bold: true } }] }])
        // The next step reloads into this topic: clear the draft and wait until it is stored, so it cannot come back.
        await field.fill('')
        await expect.poll(drafts).toBe(draftsAtStart)
      } finally {
        release()
        await juno.win.unrouteAll({ behavior: 'wait' })
      }
    })
  }
})
