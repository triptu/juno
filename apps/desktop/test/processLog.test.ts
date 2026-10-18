import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { installProcessLog } from '../src/processLog'

const EVENTS = ['unhandledRejection', 'uncaughtException'] as const

it('installs once per process, and main logs an unhandled rejection without exiting', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'juno-logs-'))
  const { warn, error } = console
  const before = new Map(EVENTS.map((event) => [event, process.listeners(event) as unknown[]]))
  const added = (event: typeof EVENTS[number]) => process.listeners(event).filter((listener) => !before.get(event)!.includes(listener))
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  try {
    const logger = installProcessLog('main', folder)
    expect(installProcessLog('main', folder)).toBe(logger)
    expect(added('unhandledRejection')).toHaveLength(1)
    expect(added('uncaughtException')).toHaveLength(1)
    added('unhandledRejection')[0]!(new Error('rejected for a test'), Promise.resolve())
    await logger.close()
    expect(await readFile(join(folder, 'main.log'), 'utf8')).toMatch(/ERROR main unhandled rejection cause=Error stack=\d+:\d+/)
    expect(exit).not.toHaveBeenCalled()
  } finally {
    for (const event of EVENTS) for (const listener of added(event)) process.off(event, listener)
    Object.assign(console, { warn, error })
    exit.mockRestore()
    await rm(folder, { recursive: true, force: true })
  }
})
