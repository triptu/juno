import { describe, expect, it } from 'bun:test'
import { messageLink, parseSlackLink, slackLink } from '../src/links'

const channel = { id: 'C024BE91L' } as never
const workspace = { url: 'https://acme.slack.com/', teamId: 'T0ACME' }
const message = (ts: string, threadTs?: string) => ({ kind: 'message', channel: 'C024BE91L', ts, ...(threadTs === undefined ? {} : { threadTs }) })
const inChannel = { kind: 'channel', channel: 'C024BE91L' }
const maya = { kind: 'person', user: 'U0MAYA' }

describe('Slack links', () => {
  it('a thread links to its root message, Main to its channel', () => {
    expect(slackLink('https://acme.slack.com/', { channel, rootTs: '1712345678.000200' })).toBe('https://acme.slack.com/archives/C024BE91L/p1712345678000200')
    expect(slackLink('https://acme.slack.com', { channel })).toBe('https://acme.slack.com/archives/C024BE91L')
  })

  it('a message link reads back as the same message, a reply with its thread', () => {
    const reply = messageLink('https://acme.slack.com/', 'C024BE91L', '1712345690.000300', '1712345678.000200')
    expect(reply).toBe('https://acme.slack.com/archives/C024BE91L/p1712345690000300?thread_ts=1712345678.000200&cid=C024BE91L')
    expect(parseSlackLink(reply, workspace)?.target).toEqual(message('1712345690.000300', '1712345678.000200'))
    expect(parseSlackLink(messageLink('https://acme.slack.com/', 'C024BE91L', '1712345678.000200', '1712345678.000200'), workspace)?.target).toEqual(message('1712345678.000200'))
  })
})

describe('reading a Slack link', () => {
  it.each<[string, unknown]>([
    // Permalinks: a reply carries its thread, a root that names its own thread is a plain message.
    ['https://acme.slack.com/archives/C024BE91L/p1712345678000200', { ours: true, target: message('1712345678.000200') }],
    ['https://acme.slack.com/archives/C024BE91L/p1712345690000300?thread_ts=1712345678.000200&cid=C024BE91L', { ours: true, target: message('1712345690.000300', '1712345678.000200') }],
    ['https://acme.slack.com/archives/C024BE91L/p1712345678000200?thread_ts=1712345678.000200&cid=C024BE91L', { ours: true, target: message('1712345678.000200') }],
    ['https://acme.slack.com/archives/C024BE91L', { ours: true, target: inChannel }],
    ['https://acme.slack.com/team/U0MAYA', { ours: true, target: maya }],
    // slack:// deep links.
    ['slack://channel?team=T0ACME&id=C024BE91L&message=1712345678.000200', { ours: true, target: message('1712345678.000200'), teamId: 'T0ACME' }],
    ['slack://channel?team=T0ACME&id=C024BE91L&message=1712345690.000300&thread_ts=1712345678.000200', { ours: true, target: message('1712345690.000300', '1712345678.000200'), teamId: 'T0ACME' }],
    ['slack://channel?team=T0ACME&id=C024BE91L', { ours: true, target: inChannel, teamId: 'T0ACME' }],
    ['slack://user?team=T0ACME&id=U0MAYA', { ours: true, target: maya, teamId: 'T0ACME' }],
    // app.slack.com client paths.
    ['https://app.slack.com/client/T0ACME/C024BE91L', { ours: true, target: inChannel, teamId: 'T0ACME' }],
    ['https://app.slack.com/client/T0ACME/C024BE91L/thread/C024BE91L-1712345678.000200', { ours: true, target: message('1712345678.000200'), teamId: 'T0ACME' }],
    ['https://app.slack.com/client/T0ACME/C024BE91L/p1712345678000200', { ours: true, target: message('1712345678.000200'), teamId: 'T0ACME' }],
    ['https://app.slack.com/client/T0ACME/user_profile/U0MAYA', { ours: true, target: maya, teamId: 'T0ACME' }],
    // Another workspace is not ours.
    ['https://other.slack.com/archives/C024BE91L/p1712345678000200', { ours: false, target: message('1712345678.000200') }],
    ['slack://channel?team=T0OTHER&id=C024BE91L', { ours: false, target: inChannel, teamId: 'T0OTHER' }],
    ['https://app.slack.com/client/T0OTHER/C024BE91L', { ours: false, target: inChannel, teamId: 'T0OTHER' }],
    // Other links are left alone.
    ['https://slack.com/help', undefined],
    ['https://acme.slack.com/files/U0MAYA/F123/report.pdf', undefined],
    ['https://example.com/archives/C024BE91L/p1712345678000200', undefined],
    ['not a url', undefined],
  ])('%s', (link, expected) => {
    expect(parseSlackLink(link, workspace)).toEqual<unknown>(expected)
  })

  it('matches a workspace by its host and port', () => {
    expect(parseSlackLink('http://127.0.0.1:4100/archives/C024BE91L', { url: 'http://127.0.0.1:4100/', teamId: 'T0ACME' })?.ours).toBe(true)
  })
})
