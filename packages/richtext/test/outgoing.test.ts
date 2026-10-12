import { describe, expect, it } from 'vitest'
import { composeOutgoing, type MentionTargets } from '../src/index'

const targets: MentionTargets = {
  people: [
    { id: 'U0MAYA', name: 'Maya Chen' },
    { id: 'U0MAYA2', name: 'Maya Lindqvist' },
    { id: 'U0LEO', name: 'Leo Park' },
  ],
  channels: [
    { id: 'C0ENG', name: 'eng' },
    { id: 'C0ENGINFRA', name: 'eng-infra' },
  ],
  customEmoji: (name) => name === 'partyparrot',
}

describe('composer text to outgoing message', () => {
  it('sends plain text as one rich_text section plus the same text', () => {
    expect(composeOutgoing('hello world', targets)).toEqual({
      blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'hello world' }] }] }],
      text: 'hello world',
    })
  })

  it('sends nothing for empty or whitespace input', () => {
    expect(composeOutgoing('   \n', targets)).toEqual({ blocks: [], text: '' })
  })

  it('turns @Name and #channel tokens into mention elements, longest name first', () => {
    const out = composeOutgoing('@Maya Chen and @Maya Lindqvist, see #eng-infra not #eng', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'user', user_id: 'U0MAYA' },
        { type: 'text', text: ' and ' },
        { type: 'user', user_id: 'U0MAYA2' },
        { type: 'text', text: ', see ' },
        { type: 'channel', channel_id: 'C0ENGINFRA' },
        { type: 'text', text: ' not ' },
        { type: 'channel', channel_id: 'C0ENG' },
      ],
    })
    expect(out.text).toBe('<@U0MAYA> and <@U0MAYA2>, see <#C0ENGINFRA|eng-infra> not <#C0ENG|eng>')
  })

  it('matches a first name only when it is unambiguous', () => {
    expect(composeOutgoing('thanks @Leo', targets).blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'thanks ' }, { type: 'user', user_id: 'U0LEO' }],
    })
    // Two Mayas: "@Maya" alone picks the first listed, which is the caller's recency order.
    expect(composeOutgoing('thanks @Maya', targets).blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'thanks ' }, { type: 'user', user_id: 'U0MAYA' }],
    })
  })

  it('does not treat emails or words as mentions', () => {
    const out = composeOutgoing('mail leo@eng.example or #engineering', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'mail leo@eng.example or #engineering' }],
    })
  })

  it('sends @here, @channel and @everyone as broadcasts', () => {
    const out = composeOutgoing('@here standup', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'broadcast', range: 'here' }, { type: 'text', text: ' standup' }],
    })
    expect(out.text).toBe('<!here> standup')
  })

  it('turns "> " lines into a quote element and keeps the reply as a section', () => {
    const out = composeOutgoing('> can we ship Friday?\n> or Monday\nFriday works.', targets)
    expect(out.blocks[0]?.elements).toEqual([
      { type: 'rich_text_quote', elements: [{ type: 'text', text: 'can we ship Friday?\nor Monday' }] },
      { type: 'rich_text_section', elements: [{ type: 'text', text: 'Friday works.' }] },
    ])
    expect(out.text).toBe('&gt; can we ship Friday?\n&gt; or Monday\nFriday works.')
  })

  it('keeps newlines inside one section', () => {
    expect(composeOutgoing('one\ntwo', targets).blocks[0]?.elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'one\ntwo' }] }])
  })

  it('escapes angle brackets and ampersands in the text fallback only', () => {
    const out = composeOutgoing('a < b & c > d', targets)
    expect(out.blocks[0]?.elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'a < b & c > d' }] }])
    expect(out.text).toBe('a &lt; b &amp; c &gt; d')
  })

  it('sends known and custom emoji shortcodes as emoji elements and leaves unknown ones as text', () => {
    const out = composeOutgoing('ship it :rocket: :partyparrot: :nope: 10:30', targets)
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'ship it ' },
        { type: 'emoji', name: 'rocket', unicode: '1f680' },
        { type: 'text', text: ' ' },
        { type: 'emoji', name: 'partyparrot' },
        { type: 'text', text: ' :nope: 10:30' },
      ],
    })
    expect(out.text).toBe('ship it :rocket: :partyparrot: :nope: 10:30')
  })
})
