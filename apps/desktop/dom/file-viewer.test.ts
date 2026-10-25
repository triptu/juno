// Files other than pictures in the media viewer (SPEC section 8, "Other
// files"): a Markdown snippet, a CSV and audio open from their cards in the
// viewer. A PDF, an HTML page and Quick Look are main's, in the electron
// project (`e2e/file-viewer.spec.ts`).
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import type { Query } from './query'
import { domTest } from './test'

const ENG_MAIN = '#eng'

/** Opens #eng with a message from Maya carrying one file of each kind given. */
async function postFiles(juno: Juno, fake: FakeSlack, text: string, kinds: ReadonlyArray<string>): Promise<Query> {
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
  fake.control('injectFiles', { channel: 'C0ENG', text, files: kinds.map((kind) => ({ kind })) })
  const row = juno.topic.message(text)
  await expect(row.locator('[data-file-card]')).toHaveCount(kinds.length)
  return row
}

async function openCard(juno: Juno, row: Query, name: string): Promise<Query> {
  await row.getByRole('button', { name: `Open ${name}` }).click()
  const viewer = juno.win.getByRole('dialog')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText(name)
  return viewer
}

domTest('file cards open Markdown, CSV, audio and voice clips, with viewer navigation and external links', async ({ juno, fake, step }) => {
  await step('read snippets and move between files', async () => {
    const row = await postFiles(juno, fake, 'Notes and metrics', ['markdown', 'csv'])
    const viewer = await openCard(juno, row, 'release-notes.md')
    // The snippet's preview is cut short; the viewer reads the whole file.
    await expect(viewer.locator('[data-viewer-text]').getByText('Release 4.2', { exact: true })).toBeVisible()
    await expect(viewer.locator('[data-viewer-text]').getByText('Questions go to the release thread.')).toBeVisible()
    await expect(viewer.locator('[data-viewer-meta]')).toHaveText(/ · 1 of 2$/)
    // Its links are in the tab order and open as a message's do: ⌘-click in the browser.
    const link = viewer.locator('[data-viewer-text]').getByRole('link', { name: 'the tracker' })
    await expect(link).not.toHaveAttribute('tabindex', '-1')
    await link.click({ modifiers: ['Meta'] })
    await expect.poll(() => juno.browserLinks()).toContain('https://example.com/tracker')

    await juno.win.keyboard.press('ArrowRight')
    await expect(viewer.locator('[data-viewer-name]')).toHaveText('cluster-metrics.csv')
    const table = viewer.getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveCount(40)
    await expect(table.getByRole('columnheader').first()).toHaveText('host')
    await expect(table.getByRole('row')).toHaveCount(81)
    // A quoted field keeps its comma.
    await expect(table.getByRole('cell', { name: 'eu-west, 1' }).first()).toBeVisible()
    await juno.win.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
  })
  await step('play recordings and voice clips', async () => {
    const row = await postFiles(juno, fake, 'Stand-up recording', ['audio'])
    await expect(row.locator('audio[data-inline-audio]')).toHaveAttribute('src', /^(?:juno:\/\/|\/__juno\/)files\//)
    await expect(row.locator('[data-file-card]')).toContainText('5:00')
    const viewer = await openCard(juno, row, 'standup-recording.wav')
    const player = viewer.locator('audio[controls]')
    await expect(player).toHaveCount(1)
    await expect(viewer.locator('[data-viewer-item]')).toContainText('5:00')
    await juno.win.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)

    fake.control('injectFiles', { channel: 'C0ENG', text: 'Voice note', files: [{ kind: 'voice' }] })
    const voice = juno.topic.message('Voice note')
    // A voice clip plays Slack's transcoded copy.
    await expect(voice.locator('audio[data-inline-audio]')).toHaveAttribute('src', /aac%3D1$/)
  })
}, { timeout: 120_000 })
