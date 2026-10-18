import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { installProcessLog } from '../src/processLog'

it('installs once per process, and main logs an unhandled rejection without exiting', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'juno-logs-'))
  const { warn, error } = console
  const before = { rejection: process.listeners('unhandledRejection'), exception: process.listeners('uncaughtException') }
  const added = () => ({
    rejection: process.listeners('unhandledRejection').filter((listener) => !before.rejection.includes(listener)),
    exception: process.listeners('uncaughtException').filter((listener) => !before.exception.includes(listener)),
  })
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  try {
    const logger = installProcessLog('main', folder)
    expect(installProcessLog('main', folder)).toBe(logger)
    expect(added().rejection).toHaveLength(1)
    expect(added().exception).toHaveLength(1)
    // Called directly, so the test runner's own listener does not see it.
    added().rejection[0]!(new Error('rejected for a test'), Promise.resolve())
    await logger.close()
    expect(await readFile(join(folder, 'main.log'), 'utf8')).toMatch(/ERROR main unhandled rejection cause=Error stack=\d+:\d+/)
    expect(exit).not.toHaveBeenCalled()
  } finally {
    for (const listener of added().rejection) process.off('unhandledRejection', listener)
    for (const listener of added().exception) process.off('uncaughtException', listener)
    Object.assign(console, { warn, error })
    exit.mockRestore()
    await rm(folder, { recursive: true, force: true })
  }
})
