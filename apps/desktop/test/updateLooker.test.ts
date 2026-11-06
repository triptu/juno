/**
 * A signed build's look for updates (`src/main/updateLooker.ts`): the looker
 * reports a download's progress and its end for the look in progress, and
 * nothing for a look that `reset` dropped. The unsigned DMG offer and the
 * About page are e2e/updates.spec.ts. electron-updater is faked.
 */
import { expect, it } from 'bun:test'
import type { UpdateCheckResult } from 'electron-updater'
import { eventually } from '@juno/testing/eventually'
import { createLooker, type SignedUpdater, type UpdaterEvents } from '../src/main/updateLooker'

/** electron-updater as the looker uses it: every check finds `version`, and each download waits for the test. */
function fakeUpdater(version: string) {
  let pending: { readonly resolve: () => void; readonly reject: (cause: Error) => void } | undefined
  const fake = {
    events: undefined as UpdaterEvents | undefined,
    downloads: 0,
    updater: {
      checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version }, cancellationToken: { cancel: () => pending?.reject(new Error('Cancelled')) } }) as unknown as UpdateCheckResult,
      downloadUpdate: () => {
        fake.downloads += 1
        return new Promise<Array<string>>((resolve, reject) => { pending = { resolve: () => resolve([]), reject } })
      },
      quitAndInstall: () => {},
    } satisfies SignedUpdater,
    finish: () => pending?.resolve(),
  }
  return fake
}

it('a look started after automatic updates were turned off and on again reports its download', async () => {
  const reported: string[] = []
  const fake = fakeUpdater('1.1.0')
  const looker = createLooker(
    {
      signed: true,
      version: '1.0.0',
      latest: async () => ({ version: '1.1.0', dmg: null }),
      load: async (events) => {
        fake.events = events
        return fake.updater
      },
    },
    {
      offer: (release, download) => reported.push(`offer ${release.version} ${download}`),
      progress: (share) => reported.push(`progress ${share}`),
      ready: (version) => reported.push(`ready ${version}`),
      idle: () => reported.push('idle'),
    },
  )
  const first = looker.find()
  await eventually(() => expect(fake.downloads).toBe(1), { timeout: 2_000 })
  // Automatic updates off: the look in progress is dropped and its download cancelled.
  looker.reset()
  expect(await first).toBe('none')
  // On again: a new look, with the same updater.
  looker.reset()
  const second = looker.find()
  await eventually(() => expect(fake.downloads).toBe(2), { timeout: 2_000 })
  fake.events!.progress(0.5)
  fake.events!.downloaded('1.1.0')
  fake.finish()
  expect(await second).toBe('found')
  expect(reported).toEqual(['offer 1.1.0 downloading', 'offer 1.1.0 downloading', 'progress 0.5', 'ready 1.1.0'])
})
