// Files still being read when Enter is pressed (spec section 8; architecture 9, "Upload"): the post names
// them at once and goes when they are ready, a restart keeps the bytes already on disk, and a file whose bytes
// never all come leaves the post so Retry sends the rest. Every test starts warm on the synced default workspace.
import { randomUUID } from 'node:crypto'
import { expect, it } from 'bun:test'
import { filesStage } from '@juno/contract'
import { samplePng } from '@juno/fake-slack'
import { retryMessage, runCommand, sendMessage } from '@juno/state'
import { waitFor, WAIT_MS } from '../harness'
import { eng, MAIN, outboxScenario, rowWith, send, settled } from '../outboxScenario'
import { valueOf } from '../scenario'
import { step } from '../step'

const { booted, watch, opened, restarted } = outboxScenario()

it('after a restart, sends a post that named a file still being read whose bytes are all on disk, and drops a file the restart lost so Retry sends the rest', async () => {
  const first = await booted()
  const rows = await opened(first)
  // An earlier post Slack holds keeps the channel's later rows waiting, so the files post is not looked at before the restart.
  first.fake.holdFrames({ types: ['message'] })
  first.fake.holdNext({ method: 'chat.postMessage' })
  await send(first, 'Before the files', rows)
  await waitFor(() => (first.fake.heldCount({ method: 'chat.postMessage' }) === 1 ? true : undefined), WAIT_MS, 'the held answer')
  // The composer names each file with an empty first chunk before it reads any bytes.
  const png = samplePng(800, 600)
  const chart = { id: randomUUID(), name: 'chart.png', mimetype: 'image/png' }
  const notes = { id: randomUUID(), name: 'notes.txt', mimetype: 'text/plain' }
  valueOf(await runCommand(first.registry, filesStage, { ...chart, offset: 0, size: png.byteLength, bytes: new Uint8Array(0), last: false }))
  valueOf(await runCommand(first.registry, filesStage, { ...notes, offset: 0, size: 24, bytes: new Uint8Array(0), last: false }))
  // Enter before either is read.
  valueOf(await sendMessage(first.registry, eng, 'With the files', MAIN, [chart.id, notes.id]))
  await rows((list) => rowWith(list, 'With the files')?.files.length === 2, 'the post with both files')
  // The chart's bytes all arrive; the notes never do.
  valueOf(await runCommand(first.registry, filesStage, { ...chart, offset: 0, bytes: new Uint8Array(png), last: true }))
  const engine = await restarted(first, (fake) => {
    fake.releaseFrames({ drop: true })
    fake.release()
  })
  const after = watch(engine, MAIN)
  await after(settled('Before the files'), 'the earlier post stored after the restart')

  await step('fails the post without the lost file, and keeps the one whose bytes are on disk', async () => {
    const failed = rowWith(await after((list) => rowWith(list, 'With the files')?.pending === 'failed', 'the post failed'), 'With the files')!
    expect(failed.files.map((file) => file.name)).toEqual(['chart.png'])
  })

  await step('Retry sends it with the chart', async () => {
    const failed = rowWith(await after((list) => rowWith(list, 'With the files') !== undefined, 'the row'), 'With the files')!
    valueOf(await retryMessage(engine.registry, failed.clientMsgId!))
    await after(settled('With the files'), 'sent after Retry')
    expect(engine.fake.messages('C0ENG').find((m) => m.text === 'With the files')?.files?.map((file) => ({ name: file.name, size: file.size }))).toEqual([{ name: 'chart.png', size: png.byteLength }])
  })
})
