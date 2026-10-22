import { describe, expect, it } from 'vitest'
import { parseSlackLink, slackLink } from '../src/links'

const channel = { id: 'C024BE91L' } as never
const workspace = { url: 'https://acme.slack.com/', teamId: 'T0ACME' }

describe('Slack links', () => {
  it('a thread links to its root message, Main to its channel', () => {
    expect(slackLink('https://acme.slack.com/', { channel, rootTs: '1712345678.000200' })).toBe('https://acme.slack.com/archives/C024BE91L/p1712345678000200')
    expect(slackLink('https://acme.slack.com', { channel })).toBe('https://acme.slack.com/archives/C024BE91L')
  })
})

describe('reading a Slack link', () => {
  it('reads a permalink to a message in the workspace', () => {
    expect(parseSlackLink('https://acme.slack.com/archives/C024BE91L/p1712345678000200', workspace)).toEqual({
      ours: true,
      target: { kind: 'message', channel: 'C024BE91L', ts: '1712345678.000200' },
    })
  })

  it('reads a reply permalink with its thread', () => {
    expect(parseSlackLink('https://acme.slack.com/archives/C024BE91L/p1712345690000300?thread_ts=1712345678.000200&cid=C024BE91L', workspace)?.target).toEqual({
      kind: 'message',
      channel: 'C024BE91L',
      ts: '1712345690.000300',
      threadTs: '1712345678.000200',
    })
  })

  it('reads a root permalink that names its own thread as a plain message', () => {
    expect(parseSlackLink('https://acme.slack.com/archives/C024BE91L/p1712345678000200?thread_ts=1712345678.000200&cid=C024BE91L', workspace)?.target).toEqual({
      kind: 'message',
      channel: 'C024BE91L',
      ts: '1712345678.000200',
    })
  })

  it('reads a reply permalink with its thread', () => {
    const link = 'https://acme.slack.com/archives/C024BE91L/p1712345690000300?thread_ts=1712345678.000200&cid=C024BE91L'
    expect(parseSlackLink(link, workspace)).toEqual({ ours: true, target: { kind: 'message', channel: 'C024BE91L', ts: '1712345690.000300', threadTs: '1712345678.000200' } })
  })

  it('reads channel and profile links', () => {
    expect(parseSlackLink('https://acme.slack.com/archives/C024BE91L', workspace)).toEqual({ ours: true, target: { kind: 'channel', channel: 'C024BE91L' } })
    expect(parseSlackLink('https://acme.slack.com/team/U0MAYA', workspace)).toEqual({ ours: true, target: { kind: 'person', user: 'U0MAYA' } })
  })

  it('reads slack:// deep links', () => {
    expect(parseSlackLink('slack://channel?team=T0ACME&id=C024BE91L&message=1712345678.000200', workspace)).toEqual({
      ours: true,
      target: { kind: 'message', channel: 'C024BE91L', ts: '1712345678.000200' },
      teamId: 'T0ACME',
    })
    expect(parseSlackLink('slack://channel?team=T0ACME&id=C024BE91L&message=1712345690.000300&thread_ts=1712345678.000200', workspace)?.target).toEqual({
      kind: 'message',
      channel: 'C024BE91L',
      ts: '1712345690.000300',
      threadTs: '1712345678.000200',
    })
    expect(parseSlackLink('slack://channel?team=T0ACME&id=C024BE91L', workspace)?.target).toEqual({ kind: 'channel', channel: 'C024BE91L' })
    expect(parseSlackLink('slack://user?team=T0ACME&id=U0MAYA', workspace)?.target).toEqual({ kind: 'person', user: 'U0MAYA' })
  })

  it('reads app.slack.com client links', () => {
    expect(parseSlackLink('https://app.slack.com/client/T0ACME/C024BE91L', workspace)).toEqual({ ours: true, target: { kind: 'channel', channel: 'C024BE91L' }, teamId: 'T0ACME' })
    expect(parseSlackLink('https://app.slack.com/client/T0ACME/C024BE91L/thread/C024BE91L-1712345678.000200', workspace)?.target).toEqual({
      kind: 'message',
      channel: 'C024BE91L',
      ts: '1712345678.000200',
    })
    expect(parseSlackLink('https://app.slack.com/client/T0ACME/C024BE91L/p1712345678000200', workspace)?.target).toEqual({ kind: 'message', channel: 'C024BE91L', ts: '1712345678.000200' })
    expect(parseSlackLink('https://app.slack.com/client/T0ACME/user_profile/U0MAYA', workspace)?.target).toEqual({ kind: 'person', user: 'U0MAYA' })
  })

  it('marks links to another workspace as not ours', () => {
    expect(parseSlackLink('https://other.slack.com/archives/C024BE91L/p1712345678000200', workspace)?.ours).toBe(false)
    expect(parseSlackLink('slack://channel?team=T0OTHER&id=C024BE91L', workspace)).toEqual({ ours: false, target: { kind: 'channel', channel: 'C024BE91L' }, teamId: 'T0OTHER' })
    expect(parseSlackLink('https://app.slack.com/client/T0OTHER/C024BE91L', workspace)?.ours).toBe(false)
  })

  it('leaves other links alone', () => {
    expect(parseSlackLink('https://slack.com/help', workspace)).toBeUndefined()
    expect(parseSlackLink('https://acme.slack.com/files/U0MAYA/F123/report.pdf', workspace)).toBeUndefined()
    expect(parseSlackLink('https://example.com/archives/C024BE91L/p1712345678000200', workspace)).toBeUndefined()
    expect(parseSlackLink('not a url', workspace)).toBeUndefined()
  })

  it('matches a workspace by its host and port', () => {
    expect(parseSlackLink('http://127.0.0.1:4100/archives/C024BE91L', { url: 'http://127.0.0.1:4100/', teamId: 'T0ACME' })?.ours).toBe(true)
  })
})
