// The rich text of a Juno bubble (SPEC 13.1): what the model writes, in
// markdown or in HTML, and the blocks the chat draws from it.
import { expect, it } from 'vitest'
import { junoText } from '@juno/agent-contract'
import { blocksOf } from '../src/router/rich'
import type { BubbleSpan } from '../src/router/sources'

const MAYA = { channelId: 'C0ENG', ts: '1760500000.000100', place: '#eng' }
const of = (text: string) => blocksOf([{ text }])
const para = (...inlines: ReadonlyArray<object>) => ({ _tag: 'paragraph', inlines })

it('keeps plain text as one paragraph, and a blank line starts the next', () => {
  expect(of('Two things in #eng.\nBoth wait on Maya.\n\nNothing else.')).toEqual([
    para({ _tag: 'text', text: 'Two things in #eng.\nBoth wait on Maya.' }),
    para({ _tag: 'text', text: 'Nothing else.' }),
  ])
})

it('reads markdown bold, italic and inline code', () => {
  expect(of('**Staging** is *green*, _again_, after `CACHE_TTL=0`.')).toEqual([
    para(
      { _tag: 'text', text: 'Staging', bold: true },
      { _tag: 'text', text: ' is ' },
      { _tag: 'text', text: 'green', italic: true },
      { _tag: 'text', text: ', ' },
      { _tag: 'text', text: 'again', italic: true },
      { _tag: 'text', text: ', after ' },
      { _tag: 'code', text: 'CACHE_TTL=0' },
      { _tag: 'text', text: '.' },
    ),
  ])
})

it('reads the HTML tags models write as the same marks, and never shows a tag', () => {
  expect(of('<b>Staging fix (#devops):</b> <strong>done</strong>, <i>mostly</i> <em>green</em> and <code>a &lt; b</code>.')).toEqual([
    para(
      { _tag: 'text', text: 'Staging fix (#devops):', bold: true },
      { _tag: 'text', text: ' ' },
      { _tag: 'text', text: 'done', bold: true },
      { _tag: 'text', text: ', ' },
      { _tag: 'text', text: 'mostly', italic: true },
      { _tag: 'text', text: ' ' },
      { _tag: 'text', text: 'green', italic: true },
      { _tag: 'text', text: ' and ' },
      { _tag: 'code', text: 'a < b' },
      { _tag: 'text', text: '.' },
    ),
  ])
})

it('strips any other tag to its text, and leaves words in angle brackets that are not tags', () => {
  expect(junoText(of('<span class="x">Leo</span> <u>said</u> <a href="https://x.test">this</a>; Array<string> stays, as does a <b and c>.'))).toBe(
    'Leo said this; Array<string> stays, as does a <b and c>.',
  )
  // A tag left open drops, and its words stay plain.
  expect(of('<b>Staging is green')).toEqual([para({ _tag: 'text', text: 'Staging is green' })])
})

it('reads <p> and <br> as paragraphs and line breaks', () => {
  expect(of('<p>One.<br>Two.</p><p>Three.</p>')).toEqual([para({ _tag: 'text', text: 'One.\nTwo.' }), para({ _tag: 'text', text: 'Three.' })])
})

it('reads bullet and numbered lists, in markdown or HTML', () => {
  const bullets = { _tag: 'list', ordered: false, items: [[{ _tag: 'text', text: 'Review the plan' }], [{ _tag: 'text', text: 'Answer Leo', bold: true }]] }
  expect(of('Two things:\n- Review the plan\n- **Answer Leo**')).toEqual([para({ _tag: 'text', text: 'Two things:' }), bullets])
  expect(of('* Review the plan\n• **Answer Leo**')).toEqual([bullets])
  expect(of('<ul><li>Review the plan</li><li><p><b>Answer Leo</b></p></li></ul>')).toEqual([bullets])
  expect(of('3. Run it\n4. Check it')).toEqual([{ _tag: 'list', ordered: true, start: 3, items: [[{ _tag: 'text', text: 'Run it' }], [{ _tag: 'text', text: 'Check it' }]] }])
  expect(of('<ol><li>Run it</li><li>Check it</li></ol>')).toEqual([{ _tag: 'list', ordered: true, items: [[{ _tag: 'text', text: 'Run it' }], [{ _tag: 'text', text: 'Check it' }]] }])
})

it('shows a heading as a heading block, at any level, in markdown or HTML', () => {
  const heading = { _tag: 'heading', inlines: [{ _tag: 'text', text: 'What needs you' }] }
  expect(of('# What needs you\nMaya.')).toEqual([heading, para({ _tag: 'text', text: 'Maya.' })])
  expect(of('### What needs you ###')).toEqual([heading])
  expect(of('<h2>What needs you</h2>')).toEqual([heading])
  // A channel name at the start of a line is not a heading.
  expect(of('#eng is quiet.')).toEqual([para({ _tag: 'text', text: '#eng is quiet.' })])
})

it('keeps a code block as written, markup and all', () => {
  expect(of('Run this:\n```sql\nSELECT **x** FROM <b>t</b>;\n```\nThen tell me.')).toEqual([
    para({ _tag: 'text', text: 'Run this:' }),
    { _tag: 'codeBlock', text: 'SELECT **x** FROM <b>t</b>;', language: 'sql' },
    para({ _tag: 'text', text: 'Then tell me.' }),
  ])
  expect(of('<pre><code>a &amp;&amp; b</code></pre>')).toEqual([{ _tag: 'codeBlock', text: 'a && b' }])
  expect(of('`<br>` and `**`')).toEqual([para({ _tag: 'code', text: '<br>' }, { _tag: 'text', text: ' and ' }, { _tag: 'code', text: '**' })])
})

it('leaves stars and underscores that open nothing as they are', () => {
  for (const text of ['2 * 3 * 4', 'snake_case_name', 'a ** b', '**open only', 'x_1 and y_2']) {
    expect(junoText(of(text))).toBe(text)
  }
})

it('shows a markdown link and a table row as their words, and drops a rule', () => {
  expect(junoText(of('See [the plan](https://x.test/plan).\n\n---\n\n| Who | When |\n|---|---|\n| Maya | Thu |'))).toBe('See the plan.\nWho · When\nMaya · Thu')
})

it('keeps a source a link inside bold, a list item or a heading, and gives it the marks around it', () => {
  const spans: ReadonlyArray<BubbleSpan> = [
    { text: '<b>Postgres 16 (#eng):</b> ' },
    { text: 'Maya wants a reviewer', source: MAYA },
    { text: '.\n- **' },
    { text: 'before Thursday', source: MAYA },
    { text: '**' },
  ]
  expect(blocksOf(spans)).toEqual([
    para({ _tag: 'text', text: 'Postgres 16 (#eng):', bold: true }, { _tag: 'text', text: ' ' }, { _tag: 'source', text: 'Maya wants a reviewer', ...MAYA }, { _tag: 'text', text: '.' }),
    { _tag: 'list', ordered: false, items: [[{ _tag: 'source', text: 'before Thursday', ...MAYA, bold: true }]] },
  ])
})

it('shows a source the host did not name a place for with its channel id', () => {
  expect(blocksOf([{ text: 'Thursday', source: { channelId: 'C0ENG', ts: '1.0' } }])).toEqual([para({ _tag: 'source', text: 'Thursday', channelId: 'C0ENG', ts: '1.0', place: 'C0ENG' })])
})

it('gives plain text for a preview, with list items marked', () => {
  expect(junoText(of('**Two things:**\n- Review\n- Answer\n\n1. Run\n2. Check'))).toBe('Two things:\n• Review\n• Answer\n1. Run\n2. Check')
})
