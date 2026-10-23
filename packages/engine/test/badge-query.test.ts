import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'
import { defaultNotificationSettings, UserId } from '@juno/domain'
import { StoreReader, StoreWriter, transaction } from '@juno/store'
import { reindexTopics } from '@juno/sync'
import { freshStore } from '../../store/test/helpers'
import { badgePolicy, badgeStatement } from '../src/dockBadge'

it.effect('holds an early DM until its read state is known, and shares All exclusions with a mention exception', () =>
  Effect.gen(function* () {
    const writer = yield* StoreWriter
    const reader = yield* StoreReader
    const policy = badgePolicy(defaultNotificationSettings, { aiAssist: false, at: { weekday: 1, minutes: 600 } })
    const statement = badgeStatement(policy, 'U0SELF')
    const badge = Effect.map(reader.unsafe<{ active: number }>(statement.sql, statement.params), (rows) => rows[0]?.active === 1)
    const reindex = transaction(reindexTopics(['m:D'], { me: { userId: UserId.make('U0SELF') } }))
    yield* writer`INSERT INTO conversations (id, kind, user_id, is_member) VALUES ('D', 'im', 'U0OTHER', 1)`
    yield* writer`INSERT INTO messages (channel, ts, user_id, text) VALUES ('D', '1700000000.000002', 'U0OTHER', 'Already read')`
    yield* reindex
    const early = yield* reader<{ unread_count: number }>`SELECT unread_count FROM topic_index WHERE topic_id = 'm:D'`
    assert.strictEqual(early[0]?.unread_count, 1, 'the domain counts every non-own message before a pointer exists')
    assert.isFalse(yield* badge, 'unknown read state must not flash the badge')
    yield* writer`INSERT INTO channel_reads (channel, slack_last_read, counts_updated) VALUES ('D', '1700000000.000002', '1')`
    yield* writer`INSERT INTO topic_reads (topic_id, last_read_ts, observed_at) VALUES ('m:D', '1700000000.000002', '1')`
    yield* reindex
    assert.isFalse(yield* badge)
    yield* writer`INSERT INTO messages (channel, ts, user_id, text) VALUES ('D', '1700000000.000003', 'U0OTHER', 'New DM')`
    yield* reindex
    assert.isTrue(yield* badge)
    yield* writer`INSERT INTO sidebar_views (id, name, position, keep_out_of_all, created_at) VALUES ('apps', 'Automated', 0, 1, '0')`
    yield* writer`INSERT INTO sidebar_view_channels (view_id, channel, added_at) VALUES ('apps', 'D', '0')`
    assert.isFalse(yield* badge, 'an unread app DM in Automated does not count in All')
    yield* writer`DELETE FROM sidebar_view_channels`
    yield* writer`INSERT INTO automated_holds (channel) VALUES ('D')`
    assert.isFalse(yield* badge, 'first-sync holds use the same exclusion')
    yield* writer`UPDATE messages SET text = '<@U0SELF> Review this' WHERE channel = 'D' AND ts = '1700000000.000003'`
    yield* reindex
    assert.isTrue(yield* badge, 'a mention breaks through the exclusion')
    const never = badgeStatement(badgePolicy({ ...defaultNotificationSettings, people: { U0OTHER: 'never' } }, { aiAssist: false, at: { weekday: 1, minutes: 600 } }), 'U0SELF')
    const through = yield* reader.unsafe<{ active: number }>(never.sql, never.params)
    assert.strictEqual(through[0]?.active, 1, 'a direct mention gets through a Never sender')
  }).pipe(Effect.provide(freshStore)),
)
