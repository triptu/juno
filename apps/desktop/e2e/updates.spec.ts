/**
 * Updates (SPEC section 15, Settings › About). Without a releases repository
 * updates are unavailable. With one, a fake of the private repository's GitHub
 * API stands in: the app reads it with its token, offers an unsigned build's
 * DMG, and shows "What's new" from CHANGELOG.md. Nothing leaves the machine.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { version as currentVersion } from '../package.json'
import { expect, test } from './fixtures'

const nextVersion = currentVersion.replace(/\d+$/, (patch) => String(Number(patch) + 1))

test('Settings › About shows the build and keeps updates off in tests', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('About')
  await expect(juno.settings.root.getByText(/Juno 0\./)).toBeVisible()
  const updates = juno.settings.root.getByRole('checkbox', { name: 'Download updates automatically' })
  await expect(updates).not.toBeChecked()
  await expect(updates).toBeDisabled()
  await expect(win.evaluate(() => window.juno.updates.set(true))).resolves.toEqual({ kind: 'unavailable' })
  await expect(juno.settings.root.getByRole('button', { name: 'Restart to update' })).toHaveCount(0)
  await expect(juno.settings.root.getByRole('button', { name: "What's new" })).toHaveCount(0)
})

/** The token main sends to a fake server (releaseFeed.ts, E2E_UPDATE_TOKEN). */
const TOKEN = 'Bearer e2e-update-token'
const REPO = '/api/v3/repos/triptu/juno-releases'
const DMG = Buffer.from('not really a disk image')

interface FakeReleases {
  readonly url: string
  /** Every request to the API: path and the Authorization header. */
  readonly api: Array<{ readonly path: string; readonly authorization: string | undefined }>
  /** Requests for the file the asset URL redirects to, on another origin. */
  readonly files: IncomingHttpHeaders[]
  changelog: string
  readonly close: () => Promise<void>
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
}

async function startFakeReleases(): Promise<FakeReleases> {
  const files: IncomingHttpHeaders[] = []
  const fileServer = createServer((request, response) => {
    files.push(request.headers)
    response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(DMG)
  })
  const filesUrl = await listen(fileServer)
  const fake: FakeReleases = { url: '', api: [], files, changelog: '', close: async () => {} }
  const apiServer = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    fake.api.push({ path, authorization: request.headers.authorization })
    if (request.headers.authorization !== TOKEN) return response.writeHead(404).end()
    if (path === `${REPO}/releases/latest`) {
      return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        tag_name: `v${nextVersion}`,
        assets: [
          { name: `Juno-${nextVersion}-arm64.dmg`, url: `${fake.url}${REPO}/releases/assets/2` },
          { name: 'latest-mac.yml', url: `${fake.url}${REPO}/releases/assets/3` },
        ],
      }))
    }
    if (path === `${REPO}/releases/assets/2` && request.headers.accept === 'application/octet-stream') {
      return response.writeHead(302, { location: `${filesUrl}/signed/Juno-${nextVersion}-arm64.dmg?sig=1` }).end()
    }
    if (path === `${REPO}/contents/CHANGELOG.md`) return response.writeHead(200, { 'content-type': 'text/plain' }).end(fake.changelog)
    response.writeHead(404).end()
  })
  Object.assign(fake, {
    url: await listen(apiServer),
    close: async () => {
      await new Promise((resolve) => apiServer.close(resolve))
      await new Promise((resolve) => fileServer.close(resolve))
    },
  })
  return fake
}

const withReleases = test.extend<{ releases: FakeReleases }>({
  // oxlint-disable-next-line no-empty-pattern
  releases: async ({}, use) => {
    const releases = await startFakeReleases()
    await use(releases)
    await releases.close()
  },
  updateServer: async ({ releases }, use) => {
    await use(releases.url)
  },
})

withReleases('an unsigned build offers the new version as a DMG and shows what is new', async ({ juno, app, releases }) => {
  const current = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  expect(current).toBe(currentVersion)
  releases.changelog = [
    '# Changelog', '',
    `## ${nextVersion} - 2026-12-01`, '', '- Faster search.', '',
    `## ${current} - 2026-10-17`, '', '- Updates from the releases repository.', '',
  ].join('\n')
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('About')
  const about = juno.settings.root
  const updates = about.getByRole('checkbox', { name: 'Download updates automatically' })
  await expect(updates).toBeEnabled()
  await expect(updates).not.toBeChecked()

  // What's new for the installed version, fetched only when asked.
  await about.getByRole('button', { name: "What's new" }).click()
  await expect(about.getByText('Updates from the releases repository.')).toBeVisible()
  await expect(about.getByText('Faster search.')).toHaveCount(0)
  expect(releases.api.map((request) => request.path)).toEqual([`${REPO}/contents/CHANGELOG.md`])
  await about.getByRole('button', { name: "What's new" }).click()
  await expect(about.getByText('Updates from the releases repository.')).toHaveCount(0)

  // Opting in checks at once; an unsigned build offers the DMG.
  await updates.click()
  await expect(updates).toBeChecked()
  await expect(about.getByText(`Juno ${nextVersion} is available.`)).toBeVisible()
  await expect(about.getByRole('button', { name: 'Restart to update' })).toHaveCount(0)
  await about.getByRole('button', { name: "What's new" }).nth(1).click()
  await expect(about.getByText('Faster search.')).toBeVisible()
  await expect(about.getByText('Updates from the releases repository.')).toHaveCount(0)

  await about.getByRole('button', { name: 'Download the new version' }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { junoTest: { opened: string[] } }).junoTest.opened.slice())).toHaveLength(1)
  const [opened] = await app.evaluate(() => (globalThis as unknown as { junoTest: { opened: string[] } }).junoTest.opened.slice())
  expect(opened?.endsWith(`Juno-${nextVersion}-arm64.dmg`)).toBe(true)
  expect(await readFile(opened!)).toEqual(DMG)
  await expect(about.getByRole('button', { name: 'Download the new version' })).toBeEnabled()

  // The token went to the API only, never to the host the download was sent on to.
  expect(releases.api.every((request) => request.authorization === TOKEN)).toBe(true)
  expect(releases.api.some((request) => request.path.endsWith('/releases/assets/1'))).toBe(false)
  expect(releases.api.some((request) => request.path.endsWith('/releases/assets/3'))).toBe(false)
  expect(releases.files).toHaveLength(1)
  expect(releases.files[0]!.authorization).toBeUndefined()
})
