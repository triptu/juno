// Sending with a mention and with files still being read (spec section 8). A message with a picked mention gets its
// local fix line after it is sent, and Review opens it as the field showed it, the person by name. Enter while a
// file is staging sends at once: the message shows as sending with its file and goes when the file is ready, a file
// that cannot be read makes it "Not sent.", and a choice on the send check bar sends while a newly attached file is
// still being read. Every step posts once. The other send checks are in send-checks.test.ts.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { FakeSlack } from '@juno/fake-slack'
import { brief, chart, chip, chips, paste } from './attach'
import type { PageClock } from './clock'
import type { Dom } from './input'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'
/** Shares four words with the staging bill thread in #eng. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'

const posts = (fake: FakeSlack) => fake.calls.filter((call) => call.method === 'chat.postMessage')

type FileGlobals = { File: typeof File; DOMException: typeof DOMException; Event: typeof Event }

/**
 * Holds the next file read until `release`, as when the file is on a slow volume. With `fail`, the read then
 * fails. The hold puts `slice` back on its first use.
 */
function holdFileRead(dom: Dom, { fail = false }: { readonly fail?: boolean } = {}): () => void {
  const page = dom.window as unknown as FileGlobals & Window
  const proto = page.File.prototype
  const slice = proto.slice
  const waiting: Array<() => void> = []
  proto.slice = function (this: File, ...args: Parameters<File['slice']>) {
    proto.slice = slice
    const blob = slice.apply(this, args)
    const read = blob.arrayBuffer.bind(blob)
    blob.arrayBuffer = () => new Promise<ArrayBuffer>((resolve, reject) => {
      waiting.push(() => (fail ? reject(new page.DOMException('The file could not be read.', 'NotReadableError')) : void read().then(resolve)))
    })
    return blob
  }
  return () => {
    proto.slice = slice
    for (const go of waiting.splice(0)) go()
  }
}

/** The engine's time of the newest wrong-place answer, moving time so a slow model's delay passes. */
async function routeCheckAnswered(clock: PageClock, userData: string, teamId: string, since: number): Promise<void> {
  await expect.poll(async () => {
    await clock.fastForward(250)
    const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
    try {
      return (db.prepare(`SELECT coalesce(max(CAST(created_at AS INTEGER)), 0) AS n FROM ai_cache WHERE task = 'routeCheck' AND model != ''`).get() as { n: number }).n
    } finally {
      db.close()
    }
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(since)
}

domTest('a mention\'s fix line opens as the field showed it; Enter while a file is read sends once when it is ready, or not at all when it cannot be read, and a send check choice waits for it too', async ({ juno, fake, clock, userData, step }) => {
  const { topic } = juno

  await step('a message with a mention gets its fix line, and Review opens it as the field showed it', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await topic.composer.pressSequentially('Thanks @ma')
    await expect(topic.suggestion('Maya')).toBeVisible()
    await topic.composer.press('Enter')
    await topic.composer.pressSequentially('the the build is green')
    await topic.composer.press('Enter')
    await topic.expectSent('Thanks')
    expect(posts(fake).map((call) => call.args['text'])).toEqual(['Thanks <@U0MAYA> the the build is green'])
    const suggestion = juno.win.locator('[data-send-suggestion]')
    await expect(suggestion).toContainText('the the → the')
    await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
    const edit = topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(edit).toHaveValue('Thanks @Maya the build is green')
    await edit.press('Escape')
  })

  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await staging({ juno, fake, clock, userData, step })
}, { clock: true, timeout: 120_000 })

async function staging({ juno, fake, clock, userData, step }: Pick<DomContext, 'juno' | 'fake' | 'clock' | 'userData' | 'step'>): Promise<void> {
  const { topic } = juno
  await step('the message goes when the file is ready', async () => {
    fake.resetCalls()
    const release = holdFileRead(juno.win)
    await paste(topic.composer, [chart()])
    await expect(chip(topic, 'chart.png')).toBeVisible()
    await topic.send('Chart while it loads')
    // The composer empties and the message shows as sending, with its file, before the file is read.
    await expect(topic.composer).toHaveValue('')
    await expect(chips(topic)).toHaveCount(0)
    await expect(topic.message('Chart while it loads')).toHaveAttribute('data-pending', 'sending')
    await expect(topic.message('Chart while it loads')).toContainText('chart.png')
    expect(fake.calls.filter((call) => call.method === 'files.getUploadURL' || call.method === 'files.share')).toEqual([])

    release()
    await topic.expectSent('Chart while it loads')
    expect(fake.calls.filter((call) => call.method === 'files.share')).toHaveLength(1)
    expect(fake.calls.filter((call) => call.method === 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['chart.png'])
    await expect(topic.message('Chart while it loads').getByRole('button', { name: 'Open chart.png' })).toBeVisible()
  })

  await step('a file that cannot be read after Enter shows its message as not sent', async () => {
    fake.resetCalls()
    const release = holdFileRead(juno.win, { fail: true })
    await paste(topic.composer, [brief()])
    await expect(chip(topic, 'launch-brief.pdf')).toBeVisible()
    await topic.send('Brief that will not load')
    await expect(topic.message('Brief that will not load')).toHaveAttribute('data-pending', 'sending')

    release()
    const failed = topic.failed('Brief that will not load')
    await expect(failed.row).toContainText('Not sent.', { timeout: 15_000 })
    expect(fake.calls.filter((call) => call.method === 'files.getUploadURL' || call.method === 'files.share' || call.method === 'chat.postMessage')).toEqual([])
    // Nothing new can come of a retry: Delete draft takes the row away.
    await failed.discard()
    await expect(topic.message('Brief that will not load')).toHaveCount(0)
  })

  await step('a choice on the send check bar sends while a newly attached file is still being read', async () => {
    fake.resetCalls()
    // Wrong place is the one check before sending: wait for the typing pause's answer.
    const since = clock.now()
    await topic.composer.fill(BILL_REPLY)
    await routeCheckAnswered(clock, userData, fake.teamId, since)
    await topic.composer.press('Enter')
    const post = topic.root.getByRole('button', { name: /Post in thread/ })
    await expect(post).toBeVisible()

    const release = holdFileRead(juno.win)
    await paste(topic.composer, [chart()])
    await expect(chip(topic, 'chart.png')).toBeVisible()
    await post.click()
    await expect(topic.composer).toHaveValue('')
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage' || call.method === 'files.share')).toHaveLength(0)

    release()
    await expect.poll(() => fake.calls.filter((call) => call.method === 'files.share').length, { timeout: 15_000 }).toBe(1)
    expect(fake.calls.find((call) => call.method === 'files.share')!.args['thread_ts']).toBeDefined()
  })
}
