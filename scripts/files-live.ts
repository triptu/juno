#!/usr/bin/env bun
/**
 * The live files check: what Slack answers to the upload steps the outbox
 * repeats or would add (OUT-7 in docs/state-machines.md, research
 * `slack-data-access.md`, "Files"). Run with `JUNO_LIVE=1 bun run files:live`
 * after `bun run smoke:live --cache-session`. It refuses to run without
 * `JUNO_LIVE=1`.
 *
 * What it does, with a 1x1 PNG it never shares into any conversation:
 * 1. Uploads it (`files.getUploadURL`, the bytes) and completes it with
 *    `files.completeUpload`, as the outbox does before a post.
 * 2. Completes it a second time, as the outbox does when every answer to
 *    the first was lost, and reads it with `files.info`.
 * 3. Deletes it with `files.delete`, then reads it again.
 * 4. Uploads a second copy, never completes it, and deletes that one too:
 *    a post deleted while its upload was half done.
 *
 * Writes are guarded: uploads name no conversation, and `files.delete`
 * takes only a file this run made. Output: methods, `ok` or the error code,
 * and field names. No token, cookie, id, name or file content is printed.
 */
import { readCachedSession } from './live-common.ts'

if (process.env.JUNO_LIVE !== '1') {
  console.error('files-live: set JUNO_LIVE=1 to run against your real workspace.')
  process.exit(2)
}

type Json = Record<string, unknown>

const cached = await readCachedSession(process.argv.includes('--team') ? process.argv[process.argv.indexOf('--team') + 1] : undefined)
if (cached === undefined) {
  console.error('files-live: no cached session. Run `JUNO_LIVE=1 bun run smoke:live --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached
const apiBase = new URL('/api/', session.workspaceUrl).toString()

const READS = new Set(['auth.test', 'files.info'])
/** Upload steps that name no conversation: nothing this run makes is shared anywhere. */
const UPLOADS = new Set(['files.getUploadURL', 'files.completeUpload'])
/** The files this run uploaded, the only files it may read or delete. */
const madeFiles = new Set<string>()
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function call(method: string, fields: Record<string, string>): Promise<Json> {
  const ownFile = madeFiles.has(fields.file ?? '')
  const allowed = method === 'files.delete' || method === 'files.info' ? ownFile : READS.has(method) || UPLOADS.has(method)
  if (!allowed || 'channel' in fields || 'channels' in fields) throw new Error(`files-live: ${method} is not allowed here`)
  await sleep(1200)
  const body = new FormData()
  body.append('token', session.token)
  body.append('_x_reason', 'files-live')
  body.append('_x_mode', 'online')
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  const response = await fetch(`${apiBase}${method}?_x_app_name=client`, { method: 'POST', body, headers: { cookie } })
  try {
    return (await response.json()) as Json
  } catch {
    return { ok: false, error: `HTTP ${response.status}, not JSON` }
  }
}

const answer = (json: Json) => (json.ok === true ? 'ok' : `error ${String(json.error)}`)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** Gets an upload URL and sends the bytes; returns the file's id, or undefined with the reason in `report`. */
async function upload(name: string, report: Json): Promise<string | undefined> {
  const target = await call('files.getUploadURL', { filename: name, length: String(png.byteLength) })
  report.getUploadURL = answer(target)
  if (target.ok !== true || typeof target.upload_url !== 'string' || typeof target.file !== 'string') return undefined
  madeFiles.add(target.file)
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), name)
  report.bytes = (await fetch(target.upload_url, { method: 'POST', body: form })).status
  return target.file
}

/** What `files.info` says about a file, as field names and flags only. */
const describe = (json: Json) => {
  if (json.ok !== true) return answer(json)
  const file = (json.file ?? {}) as Json
  const shares = (file.shares ?? {}) as Json
  return {
    ok: true,
    fileKeys: Object.keys(file).toSorted(),
    sharedAnywhere: Object.keys(shares).length > 0 || ((file.channels as unknown[] | undefined) ?? []).length > 0,
    isPublic: file.is_public === true,
  }
}

const report: Record<string, unknown> = {}
const leftover: Array<string> = []
try {
  report.auth = answer(await call('auth.test', {}))

  const completed: Json = {}
  report.completed = completed
  const file = await upload('juno-files-check.png', completed)
  if (file !== undefined) {
    const files = JSON.stringify([{ id: file, title: 'juno-files-check.png' }])
    completed.firstCompletion = answer(await call('files.completeUpload', { files }))
    completed.secondCompletion = answer(await call('files.completeUpload', { files }))
    completed.infoAfterCompletions = describe(await call('files.info', { file }))
    completed.delete = answer(await call('files.delete', { file }))
    completed.infoAfterDelete = describe(await call('files.info', { file }))
    completed.secondDelete = answer(await call('files.delete', { file }))
    if (completed.delete !== 'ok' && completed.delete !== 'error file_deleted') leftover.push('completed file')
  }

  const uncompleted: Json = {}
  report.uncompleted = uncompleted
  const half = await upload('juno-files-check-half.png', uncompleted)
  if (half !== undefined) {
    uncompleted.infoBeforeCompletion = describe(await call('files.info', { file: half }))
    uncompleted.delete = answer(await call('files.delete', { file: half }))
    uncompleted.infoAfterDelete = describe(await call('files.info', { file: half }))
    // Slack answers `file_deleted` for an upload never completed: there is no file to leave behind.
    if (uncompleted.delete !== 'ok' && uncompleted.delete !== 'error file_deleted') leftover.push('uncompleted upload')
  }
} finally {
  if (leftover.length > 0) report.leftover = leftover
  console.log(JSON.stringify(report, null, 2))
}
