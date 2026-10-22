import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Logger } from 'effect'
import { SlackAuthRequired, SlackDecodeError, SlackRejected } from '@juno/slack'
import { expect, it } from 'vitest'
import { createLog, LOG_LIMIT, safeDetails, warningLines } from '../src/logging'

it('keeps only checked schema paths and issue kinds on SlackDecodeError', () => {
  const detail = safeDetails(new SlackDecodeError({ method: 'subscriptions.thread.getView', message: 'private response', schemaPath: 'threads[3].root_msg.latest_reply', issueKind: 'missing' }))
  expect(detail).toContain('schemaPath=threads[3].root_msg.latest_reply issueKind=missing')
  expect(detail).not.toContain('private response')
  for (const path of ['private_message', 'threads[3].private_message', 'threads[-1].root_msg', 'threads[1.5]', 'threads[0].root_msg\n', 'root_msg.text=private', 'threads[9999999999]', 'a'.repeat(301), '/Users/private/file', 'threads[0] root_msg']) {
    expect(safeDetails({ _tag: 'SlackDecodeError', schemaPath: path, issueKind: 'private' })).not.toMatch(/schemaPath=|issueKind=/)
  }
  expect(safeDetails({ schemaPath: 'threads[3].root_msg', issueKind: 'missing' })).toBe('')
  expect(safeDetails({ _tag: 'SlackRejected', schemaPath: 'threads[3].root_msg', issueKind: 'missing' })).not.toMatch(/schemaPath=|issueKind=/)
  for (const kind of ['wrong_type', 'invalid']) expect(safeDetails({ _tag: 'SlackDecodeError', schemaPath: 'threads[0].root_msg', issueKind: kind })).toContain(`issueKind=${kind}`)
})

it('keeps a checked IPC channel name and drops any other string in its place', () => {
  expect(safeDetails({ channel: 'clipboard.writeText', cause: { _tag: 'SchemaError' } })).toBe('channel=clipboard.writeText cause=SchemaError')
  for (const channel of ['private message text', 'clipboard', '/Users/private/file', 'app.copy diagnostics', `app.${'a'.repeat(80)}`, 42]) {
    expect(safeDetails({ channel })).toBe('')
  }
})

it('writes the Slack cause and method for a boot warning without the decode message', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'juno-logs-'))
  const logger = createLog('engine', folder)
  try {
    const cause = new SlackDecodeError({ method: 'client.userBoot', message: 'private schema value' })
    await Effect.runPromise(Effect.logWarning('sync: boot failed, retrying', { cause }).pipe(Effect.provide(Logger.layer([logger.effectLogger]))))
    await logger.close()
    const text = await readFile(join(folder, 'engine.log'), 'utf8')
    expect(text).toContain('WARN engine sync: boot failed, retrying cause=SlackDecodeError method=client.userBoot')
    expect(text).not.toContain('private schema value')
  } finally { await logger.close(); await rm(folder, { recursive: true, force: true }) }
})

it('keeps checked Slack methods and rejection codes and drops unchecked strings', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'juno-logs-'))
  const logger = createLog('engine', folder)
  try {
    const causes = [
      new SlackRejected({ method: 'users.prefs.get', error: 'not_allowed' }),
      { _tag: 'SlackTransportError', method: 'client.counts', message: 'private response', retryable: true },
      { _tag: 'SlackRateLimited', method: 'conversations.history', retryAfterMillis: 1000 },
      new SlackAuthRequired({ method: 'auth.test', error: 'invalid_auth' }),
    ]
    for (const cause of causes) logger.log('WARN', 'sync: boot failed, retrying', { cause })
    const invalidMethods = ['private method', 'https://private.example', 'users/info', 'socket', 'client.userBoot\n', `client.${'a'.repeat(80)}`]
    const invalidCodes = ['private error', 'https://private.example', 'not_allowed\n', 'a'.repeat(65)]
    for (const method of invalidMethods) logger.log('WARN', 'sync: boot failed, retrying', { cause: new SlackDecodeError({ method, message: 'private response' }) })
    for (const error of invalidCodes) logger.log('WARN', 'sync: boot failed, retrying', { cause: new SlackRejected({ method: 'client.counts', error }) })
    logger.log('WARN', 'sync: boot failed, retrying', { method: 'client.userBoot', error: 'not_allowed' })
    await logger.close()
    const lines = (await readFile(join(folder, 'engine.log'), 'utf8')).trimEnd().split('\n').slice(1)
    expect(lines[0]).toContain('cause=SlackRejected method=users.prefs.get code=not_allowed')
    expect(lines[1]).toContain('cause=SlackTransportError method=client.counts')
    expect(lines[2]).toContain('cause=SlackRateLimited method=conversations.history')
    expect(lines[3]).toContain('cause=SlackAuthRequired method=auth.test')
    expect(lines).toHaveLength(causes.length + invalidMethods.length + invalidCodes.length + 1)
    for (const line of lines.slice(causes.length, causes.length + invalidMethods.length)) expect(line).not.toContain('method=')
    for (const line of lines.slice(causes.length + invalidMethods.length)) expect(line).not.toContain('code=')
    expect(lines.at(-1)).not.toContain('method=')
    expect(lines.join('\n')).not.toContain('private')
    expect(lines.join('\n')).not.toContain('invalid_auth')
  } finally { await logger.close(); await rm(folder, { recursive: true, force: true }) }
})

it('never writes content, secrets, file names, error messages or paths, including nested defects', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'juno-logs-'))
  const logger = createLog('engine', folder)
  const privateValues = ['xoxc-test-private', 'd=test-cookie-private', 'sk-or-test-key-private', 'The secret launch is Thursday', 'private-plan.pdf']
  try {
    const cause = new Error(privateValues.join(' '), { cause: new Error(privateValues[0]) })
    cause.stack = `Error: ${privateValues.join(' ')}\n    at ${privateValues[4]} (/Users/private/${privateValues[4]}:12:34)`
    logger.log('ERROR', privateValues[3], { cause, text: privateValues[3], name: privateValues[4], token: privateValues[0], id: privateValues[0] })
    logger.log('WARN', 'outbox row failed', { rowId: 42, count: 3, cause })
    await Effect.runPromise(Effect.logError('send: post pass failed', { cause }).pipe(Effect.provide(Logger.layer([logger.effectLogger]))))
    await Effect.runPromise(Effect.die(cause).pipe(Effect.catchCause(Effect.logError), Effect.provide(Logger.layer([logger.effectLogger]))))
    await logger.close()
    const text = await readFile(join(folder, 'engine.log'), 'utf8')
    for (const secret of privateValues) expect(text).not.toContain(secret)
    expect(text).not.toContain('/Users/private')
    expect(text).toContain('rowId=42 count=3')
    expect(text).toContain('cause=Error stack=12:34')
    expect(text).toContain('ERROR engine send: post pass failed')
  } finally { await logger.close(); await rm(folder, { recursive: true, force: true }) }
})

it('rotates at 5 MB, keeps only three old files, and reads the last 50 warnings across rotations', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'juno-logs-'))
  try {
    for (let n = 0; n < 5; n++) {
      await writeFile(join(folder, 'main.log'), ' '.repeat(LOG_LIMIT))
      const logger = createLog('main', folder)
      logger.log('WARN', 'outbox row failed', { rowId: n })
      await logger.close()
      expect((await readFile(join(folder, 'main.log'))).length).toBeLessThan(LOG_LIMIT)
    }
    expect((await readdir(folder)).sort()).toEqual(['main.log', 'main.log.1', 'main.log.2', 'main.log.3'])
    const logger = createLog('main', folder)
    for (let rowId = 0; rowId < 60; rowId++) logger.log('WARN', 'outbox row failed', { rowId })
    await logger.close()
    const lines = (await warningLines(folder))[0]!.lines
    expect(lines).toHaveLength(50)
    expect(lines[0]).toContain('rowId=10')
    expect(lines.at(-1)).toContain('rowId=59')
  } finally { await rm(folder, { recursive: true, force: true }) }
})
