/**
 * The feel suite's fixture. `feel.run(scenario, action)` records the action,
 * runs the scenario's checks, writes the frames, filmstrip, video and
 * result under `feel-report/<name>/`, and fails the test softly for each
 * failed check, so the other scenarios in the test still record.
 */
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test as base } from '../fixtures'
import type { Check, Verdict } from './checks'
import { Recorder, type Probe } from './recorder'
import { currentLoad, encodeVideo, REPORT_DIR, Studio, writeResult } from './studio'

export interface Scenario {
  /** Folder name and id in the contact sheet. */
  readonly name: string
  /** What a person does, in a sentence. */
  readonly title: string
  readonly probes: ReadonlyArray<Probe>
  /** Name to selector, for the pixel checks. `window` is always there. */
  readonly regions?: Readonly<Record<string, string>>
  /** How long to keep recording after the action. Default 600 ms. */
  readonly settleMs?: number
  readonly checks: ReadonlyArray<Check>
}

export class Feel {
  constructor(
    readonly win: Page,
    readonly studio: Studio,
    readonly testTitle: string,
  ) {}

  async run(scenario: Scenario, action: (recorder: Recorder) => Promise<void>): Promise<ReadonlyArray<Verdict>> {
    const dir = join(REPORT_DIR, scenario.name)
    const recorder = await Recorder.start(this.win, { probes: scenario.probes, regions: scenario.regions ?? {} })
    let failure: unknown
    try {
      await action(recorder)
    } catch (error) {
      failure = error
    }
    const recording = await recorder.stop(scenario.settleMs)
    const pixels = await this.studio.analyse(dir, recording)
    const verdicts: Verdict[] = scenario.checks.map((check) => {
      try {
        return check({ recording, pixels })
      } catch (error) {
        return { name: 'check could not run', status: 'fail', detail: String(error), shots: [] }
      }
    })
    if (failure !== undefined) verdicts.unshift({ name: 'the scripted steps ran', status: 'fail', detail: String(failure).split('\n')[0] ?? '', shots: [recording.shots.at(-1)?.number ?? 0] })
    const filmstrip = await this.studio.filmstrip(dir, `${scenario.name}: ${scenario.title}`, recording, pixels, verdicts)
    const video = await encodeVideo(dir, recording)
    const t0 = recording.shots[0]?.t ?? 0
    const failed = verdicts.filter((v) => v.status === 'fail')
    await writeResult(dir, {
      name: scenario.name,
      title: scenario.title,
      test: this.testTitle,
      status: failed.length === 0 ? 'pass' : 'fail',
      verdicts,
      frames: recording.shots.length,
      animationFrames: recording.frames.length,
      durationMs: Math.round(recording.endedAt - recording.startedAt),
      load: currentLoad(),
      timeline: recording.shots.map((shot) => Math.round(shot.t - t0)),
      video: video.file,
      filmstrip,
      notes: video.note === undefined ? [] : [video.note],
    })
    if (failure !== undefined) throw failure
    expect.soft(failed.map((v) => `${scenario.name}: ${v.name}: ${v.detail} (frames ${v.shots.join(', ')})`), `feel checks, see feel-report/${scenario.name}`).toEqual([])
    return verdicts
  }
}

/** A scenario that cannot run yet; it shows in the contact sheet with the reason. */
export async function recordSkipped(name: string, title: string, testTitle: string, reason: string): Promise<void> {
  await writeResult(join(REPORT_DIR, name), { name, title, test: testTitle, status: 'skipped', reason, verdicts: [], frames: 0, animationFrames: 0, durationMs: 0, load: currentLoad(), timeline: [], video: null, filmstrip: null, notes: [] })
}

export const test = base.extend<{ feel: Feel }, { studio: Studio }>({
  studio: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const studio = new Studio()
      await use(studio)
      await studio.close()
    },
    { scope: 'worker' },
  ],
  feel: async ({ win, studio }, use, info) => {
    await use(new Feel(win, studio, info.title))
  },
})

export { expect }
