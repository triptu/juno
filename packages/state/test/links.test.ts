import { describe, expect, it } from 'vitest'
import { slackLink } from '../src/links'

const channel = { id: 'C024BE91L' } as never

describe('Slack links', () => {
  it('a thread links to its root message, Main to its channel', () => {
    expect(slackLink('https://acme.slack.com/', { channel, rootTs: '1712345678.000200' })).toBe('https://acme.slack.com/archives/C024BE91L/p1712345678000200')
    expect(slackLink('https://acme.slack.com', { channel })).toBe('https://acme.slack.com/archives/C024BE91L')
  })
})
