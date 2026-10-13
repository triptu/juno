/**
 * Every shape the live smoke recorded (test/fixtures/recorded/) decodes
 * with the schema of its method or frame. The fixtures are redacted: ids,
 * text, URLs and timestamps are placeholders, arrays are cut to three
 * items, but every key and value type is as Slack sent it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { decodeRtmFrame, isMethodName, Methods } from '@juno/slack-schema'

const dir = join(import.meta.dirname, 'fixtures', 'recorded')
const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

const responses = readdirSync(dir).filter((name) => name.endsWith('.json'))
const frames = readdirSync(join(dir, 'rtm')).filter((name) => name.endsWith('.json'))

describe('recorded responses', () => {
  it('cover the calls the smoke makes', () => {
    expect(responses).toEqual(
      expect.arrayContaining([
        'auth.test.json',
        'client.userBoot.json',
        'client.counts.json',
        'subscriptions.thread.getView.json',
        'conversations.history.json',
        'client.getWebSocketURL.json',
      ]),
    )
  })

  for (const file of responses) {
    const method = file.slice(0, -'.json'.length)
    it(`${method} decodes as ok`, () => {
      if (!isMethodName(method)) throw new Error(`${method} is not in Methods`)
      const decoded = Schema.decodeUnknownSync(Methods[method].response)(read(join(dir, file)))
      expect(decoded.ok).toBe(true)
    })
  }

  it('client.userBoot keeps the fields Juno reads', () => {
    const boot = Schema.decodeUnknownSync(Methods['client.userBoot'].ok)(read(join(dir, 'client.userBoot.json')))
    expect(boot.self.id).toMatch(/^U/)
    expect(boot.team.id).toMatch(/^T/)
    expect(boot.channels.length).toBeGreaterThan(0)
    expect(boot.ims.length).toBeGreaterThan(0)
    expect(boot.ims[0]?.user).toMatch(/^U/)
    expect(boot.subteams?.self).toBeDefined()
  })

  it('client.counts entries carry read state as timestamps', () => {
    const counts = Schema.decodeUnknownSync(Methods['client.counts'].ok)(read(join(dir, 'client.counts.json')))
    for (const entry of [...counts.channels, ...counts.ims, ...counts.mpims]) {
      expect(entry.last_read).toMatch(/^\d+\.\d{6}$/)
      expect(typeof entry.has_unreads).toBe('boolean')
      expect(typeof entry.mention_count).toBe('number')
    }
    expect(typeof counts.threads.has_unreads).toBe('boolean')
  })

  it('subscriptions.thread.getView roots say where they live and how far they were read', () => {
    const view = Schema.decodeUnknownSync(Methods['subscriptions.thread.getView'].ok)(read(join(dir, 'subscriptions.thread.getView.json')))
    expect(view.threads.length).toBeGreaterThan(0)
    for (const thread of view.threads) {
      expect(thread.root_msg.channel).toMatch(/^[CDG]/)
      expect(thread.root_msg.thread_ts).toBe(thread.root_msg.ts)
      expect(thread.root_msg.reply_count).toBeGreaterThan(0)
      expect(thread.latest_replies?.length).toBeGreaterThan(0)
    }
  })

  it('conversations.history messages have a ts and a user', () => {
    const history = Schema.decodeUnknownSync(Methods['conversations.history'].ok)(read(join(dir, 'conversations.history.json')))
    expect(history.messages.length).toBeGreaterThan(0)
    for (const message of history.messages) {
      expect(message.ts).toMatch(/^\d+\.\d{6}$/)
      expect(message.user).toMatch(/^U/)
    }
  })
})

describe('recorded socket frames', () => {
  it('include the connection frames', () => {
    expect(frames).toEqual(expect.arrayContaining(['hello.json', 'pong.json', 'reconnect_url.json']))
  })

  for (const file of frames) {
    const type = file.slice(0, -'.json'.length)
    it(`${type} decodes as a known frame`, () => {
      const frame = decodeRtmFrame(read(join(dir, 'rtm', file)))
      expect(frame.type).not.toBe('unknown')
      if (type.startsWith('message')) expect(frame.type).toBe('message')
      else expect(frame.type).toBe(type)
    })
  }
})
