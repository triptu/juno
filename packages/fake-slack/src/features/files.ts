import { Ts, type Message } from '@juno/slack-schema'
import type { FakeSlack } from '../index.ts'
import { fileObject } from '../files.ts'
import { sample, type SampleKind } from '../fileSamples.ts'
import type { FakeFeature } from './registry.ts'

/**
 * Files the media viewer opens (SPEC section 8, "Other files"), posted by
 * another user: a PDF, an HTML email export, a Markdown snippet, a CSV, a
 * JSON file, a log, an audio clip, a voice clip (`subtype: "slack_audio"`,
 * with `aac`) and a zip, built in `fileSamples.ts` and served with their
 * types on `GET /files/<id>/<name>`.
 */
export const filesFeature = {
  methods: {},
  controls: {
    /**
     * A message from `user` (default Maya) with one file of each kind given,
     * in order. `name` renames one; `seconds` sets a clip's length (an audio
     * clip is 5 minutes, a voice clip 14 seconds).
     */
    injectFiles: (fake, input: { channel: string; user?: string; text?: string; threadTs?: string; files: ReadonlyArray<{ kind: SampleKind; name?: string; seconds?: number }> }) => injectFiles(fake, input),
  },
} satisfies FakeFeature

function injectFiles(fake: FakeSlack, input: { channel: string; user?: string; text?: string; threadTs?: string; files: ReadonlyArray<{ kind: SampleKind; name?: string; seconds?: number }> }): Message {
  const ws = fake.workspace
  const user = input.user ?? 'U0MAYA'
  const isPublic = ws.conversations.get(input.channel)?.kind === 'public'
  const stored = input.files.map((each) => {
    const made = sample(each.kind, { ...(each.name === undefined ? {} : { name: each.name }), ...(each.seconds === undefined ? {} : { seconds: each.seconds }) })
    const id = ws.nextFileId()
    const file = { id, name: made.name, length: made.bytes.length, user, created: ws.clock.now(), bytes: made.bytes, mimetype: made.mimetype, ...(made.extra === undefined ? {} : { extra: made.extra }) }
    ws.files.set(id, file)
    return file
  })
  return ws.post({
    channel: input.channel,
    user,
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(input.threadTs === undefined ? {} : { threadTs: Ts.make(input.threadTs) }),
    files: stored.map((file) => fileObject(fake.url, file, isPublic)),
  })
}
