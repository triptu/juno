import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isMessagePosted, type MessagePostedEvent, type RtmFrame } from '@juno/slack-schema'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
import { samplePng } from '../src/samples.ts'
import { isType, TestClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient

beforeEach(async () => {
  fake = await startFakeSlack({ now: Date.UTC(2026, 9, 12, 9, 0, 0) })
  client = new TestClient(fake)
})

afterEach(async () => {
  await fake.close()
})

/** POSTs the bytes as the official client does: multipart, one field named `file`, no token, no cookie. */
function postFile(url: string, bytes: Buffer, name: string, type: string): Promise<Response> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), name)
  return fetch(url, { method: 'POST', body: form })
}

async function upload(name: string, bytes: Buffer, type: string): Promise<string> {
  const { upload_url, file } = await client.ok('files.getUploadURL', { filename: name, length: bytes.length })
  expect((await postFile(upload_url, bytes, name, type)).status).toBe(200)
  return file
}

const postedWith = (clientMsgId: string) => (frame: RtmFrame): frame is MessagePostedEvent => isMessagePosted(frame) && frame.client_msg_id === clientMsgId

describe('composer upload flow', () => {
  it('getUploadURL, a multipart POST, completeUpload and files.share post one message with the file', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    const bytes = samplePng(1200, 500)
    const { upload_url, file } = await client.ok('files.getUploadURL', { filename: 'chart.png', length: bytes.length })
    expect(file).toMatch(/^F/)
    expect((await postFile(upload_url, bytes, 'chart.png', 'image/png')).status).toBe(200)

    const done = await client.ok('files.completeUpload', { files: [{ id: file, title: 'Latency chart' }] })
    expect(done.files?.[0]?.title).toBe('Latency chart')

    const blocks = [{ type: 'rich_text' as const, elements: [{ type: 'rich_text_section' as const, elements: [{ type: 'text' as const, text: 'Latency after the fix' }] }] }]
    await client.ok('files.share', { files: [file], channel: 'C0ENG', blocks, client_msg_id: 'uuid-share-1', resharing_aware: true })

    const echo = await socket.next(postedWith('uuid-share-1'))
    expect(echo.user).toBe(fake.selfId)
    expect(echo.files?.map((f) => f.id)).toEqual([file])

    const history = await client.ok('conversations.history', { channel: 'C0ENG', limit: 1 })
    const message = history.messages[0]!
    expect(message.client_msg_id).toBe('uuid-share-1')
    expect(message.text).toBe('Latency after the fix')
    expect(message.blocks).toEqual(blocks)
    const shared = message.files?.[0]
    expect(shared).toMatchObject({
      id: file,
      name: 'chart.png',
      title: 'Latency chart',
      mimetype: 'image/png',
      filetype: 'png',
      pretty_type: 'PNG',
      user: fake.selfId,
      size: bytes.length,
      mode: 'hosted',
      is_external: false,
      is_public: true,
      original_w: 1200,
      original_h: 500,
      thumb_360_w: 360,
      thumb_360_h: 150,
      thumb_480_w: 480,
      thumb_480_h: 200,
      thumb_720_w: 720,
      thumb_720_h: 300,
      thumb_800_w: 800,
      thumb_800_h: 333,
      thumb_960_w: 960,
      thumb_960_h: 400,
      thumb_1024_w: 1024,
      thumb_1024_h: 427,
    })
    for (const size of [64, 80, 160]) expect(shared?.[`thumb_${size}` as 'thumb_64']).toBe(`${shared?.url_private}?thumb=${size}`)

    const served = await fetch(shared!.thumb_720!, { headers: { cookie: `d=${fake.credentials().cookie}` } })
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true)
    expect(served.headers.get('content-disposition')).toBeNull()
    socket.close()
  })

  it('shares into a thread as a reply broadcast with a plain comment', async () => {
    const root = fake.messages('C0ENG').find((m) => m.text?.startsWith('Draft plan is in the doc'))!
    const file = await upload('notes.txt', Buffer.from('cutover notes'), 'text/plain')
    await client.ok('files.share', { files: [file], channel: 'C0ENG', thread_ts: root.ts, broadcast: true, comment: 'Notes from the dry run', client_msg_id: 'uuid-share-2' })
    const replies = await client.ok('conversations.replies', { channel: 'C0ENG', ts: root.ts, limit: 50 })
    const reply = replies.messages.at(-1)!
    expect(reply).toMatchObject({ client_msg_id: 'uuid-share-2', text: 'Notes from the dry run', subtype: 'thread_broadcast', thread_ts: root.ts })
    expect(reply.files?.[0]).toMatchObject({ id: file, mimetype: 'text/plain', filetype: 'text', pretty_type: 'Plain Text' })
    expect(reply.files?.[0]?.thumb_360).toBeUndefined()
  })

  it('answers file_not_found before the bytes arrive, and channel errors as other writes do', async () => {
    const { file } = await client.ok('files.getUploadURL', { filename: 'late.png', length: 10 })
    expect((await client.call('files.completeUpload', { files: [{ id: file }] })).body).toEqual({ ok: false, error: 'file_not_found' })
    expect((await client.call('files.share', { files: ['F0NOPE'], channel: 'C0ENG', client_msg_id: 'uuid-x' })).body).toEqual({ ok: false, error: 'file_not_found' })
    const ready = await upload('ready.txt', Buffer.from('ok'), 'text/plain')
    expect((await client.call('files.share', { files: [ready], channel: 'C0NOWHERE', client_msg_id: 'uuid-y' })).body).toEqual({ ok: false, error: 'channel_not_found' })
  })

  it('failUploads makes the next upload POST answer 500 and keep nothing, then a retry works', async () => {
    await client.control('failUploads', { times: 1 })
    const bytes = Buffer.from('retry me')
    const { upload_url, file } = await client.ok('files.getUploadURL', { filename: 'retry.txt', length: bytes.length })
    expect((await postFile(upload_url, bytes, 'retry.txt', 'text/plain')).status).toBe(500)
    expect((await client.call('files.completeUpload', { files: [{ id: file }] })).body).toEqual({ ok: false, error: 'file_not_found' })
    expect((await postFile(upload_url, bytes, 'retry.txt', 'text/plain')).status).toBe(200)
    expect((await client.ok('files.completeUpload', { files: [{ id: file }] })).files?.[0]?.size).toBe(bytes.length)
    expect(fake.calls.filter((c) => c.kind === 'upload').map((c) => c.status)).toEqual([500, 200])
  })

  it('reads the size of JPEG, GIF and WebP headers and takes the type from the bytes', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x40, 0x01, 0xc8, 0x00]), Buffer.alloc(8)])
    const webp = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8X', 'latin1'), Buffer.alloc(8), Buffer.from([0x1f, 0x03, 0x00, 0x57, 0x02, 0x00])])
    const cases = [
      { name: 'photo.jpg', bytes: jpeg, mimetype: 'image/jpeg', w: 640, h: 480 },
      // Sent as octet-stream with the wrong extension: the bytes decide.
      { name: 'loop.bin', bytes: gif, mimetype: 'image/gif', w: 320, h: 200 },
      { name: 'shot.webp', bytes: webp, mimetype: 'image/webp', w: 800, h: 600 },
    ]
    for (const c of cases) {
      const file = await upload(c.name, c.bytes, 'application/octet-stream')
      const [object] = (await client.ok('files.completeUpload', { files: [{ id: file }] })).files ?? []
      expect({ mimetype: object?.mimetype, w: object?.original_w, h: object?.original_h }).toEqual({ mimetype: c.mimetype, w: c.w, h: c.h })
    }
  })

  it('takes the type from the extension when the bytes and the part do not say', async () => {
    const file = await upload('q1.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'), '')
    const [object] = (await client.ok('files.completeUpload', { files: [{ id: file }] })).files ?? []
    expect(object).toMatchObject({ mimetype: 'application/pdf', filetype: 'pdf', pretty_type: 'PDF' })
  })
})

describe('seeded files', () => {
  it('requires the d cookie for thumbnails and downloads, not a bearer token', async () => {
    const files = fake.messages('C0PRODUCT').flatMap((message) => message.files ?? [])
    const image = files.find((file) => file.mimetype === 'image/png')!
    for (const url of [image.thumb_360!, image.url_private_download!]) {
      for (const headers of [{}, { authorization: `Bearer ${fake.credentials().token}` }]) {
        const response = await fetch(url, { headers, redirect: 'manual' })
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/signin')
      }
      const response = await fetch(url, { headers: { cookie: `d=${fake.credentials().cookie}` } })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
    }
  })

  it('the product thread carries an image and a PDF whose urls serve real bytes', async () => {
    const root = fake.messages('C0PRODUCT').find((m) => m.text?.startsWith('Proposal: cut offline mode'))!
    const replies = await client.ok('conversations.replies', { channel: 'C0PRODUCT', ts: root.ts, limit: 50 })
    const files = replies.messages.flatMap((m) => m.files ?? [])
    expect(files.map((f) => f.name)).toEqual(['early-access-flow.png', 'q4-plan.pdf'])

    const [image, pdf] = files
    expect(image).toMatchObject({ original_w: 960, original_h: 640, thumb_960_w: 960, thumb_960_h: 640, thumb_720_w: 720, thumb_720_h: 480 })
    expect(image?.thumb_1024).toBeUndefined()

    const download = await fetch(pdf!.url_private_download!, { headers: { cookie: `d=${fake.credentials().cookie}` } })
    expect(download.headers.get('content-type')).toBe('application/pdf')
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="q4-plan.pdf"')
    const text = Buffer.from(await download.arrayBuffer()).toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(Number(download.headers.get('content-length'))).toBe(pdf?.size)
  })
})
