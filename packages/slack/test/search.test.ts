import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'
import { searchMessages, SlackApi } from '../src/index.ts'
import { clientLayer, fakeSlack } from './helpers.ts'

it.effect('message search identifies both thread roots and replies', () =>
  Effect.gen(function* () {
    const fake = yield* fakeSlack
    const matches = yield* SlackApi.use((api) => searchMessages(api, 'is:thread', 100)).pipe(Effect.provide(clientLayer(fake)))
    assert.isAbove(matches.length, 0)
    assert.isTrue(matches.every((match) => match.threadTs !== undefined))
    assert.isTrue(matches.some((match) => match.threadTs === match.ts && (match.replyCount ?? 0) > 0))
    assert.isTrue(matches.some((match) => match.threadTs !== match.ts))
    assert.strictEqual(fake.calls[0]?.args['extra_message_data'], '1')
  }),
)
