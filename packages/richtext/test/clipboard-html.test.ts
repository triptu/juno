import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import { clipboardHtml } from '../src/index'
import { growth } from './scaling'

/** `clipboardHtml` reads the browser's DOMParser, Node and Element; these come from a happy-dom window, put back after the file. */
const dom = ['DOMParser', 'Node', 'Element'] as const
const saved = dom.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
const window = new Window()
beforeAll(() => {
  for (const name of dom) Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true })
})
afterAll(async () => {
  for (const [index, name] of dom.entries()) {
    const descriptor = saved[index]
    if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }
  await window.happyDOM.close()
})

describe('rich clipboard HTML', () => {
  it('keeps Notion links and formatting', () => {
    const pasted = clipboardHtml(`
      <div><span style="font-weight: 600">Launch </span><a href="https://example.com/release">release plan</a></div>
      <div><s>Old date</s><br><code>pnpm test</code></div>
    `)

    expect(pasted).toEqual({
      text: '*Launch* release plan\n~Old date~\n`pnpm test`',
      links: [{ start: 9, end: 21, url: 'https://example.com/release' }],
    })
  })

  it('does not take Google Docs normal-weight wrappers as bold', () => {
    const pasted = clipboardHtml(`
      <b id="docs-internal-guid-1" style="font-weight: normal">
        <span style="font-weight: 700">Quarterly plan</span><span> </span>
        <a href="https://docs.google.com/document/d/example"><span>review notes</span></a>
      </b>
    `)

    expect(pasted).toEqual({
      text: '*Quarterly plan* review notes',
      links: [{ start: 17, end: 29, url: 'https://docs.google.com/document/d/example' }],
    })
  })

  it('turns web-page quotes, lists and tables into composer text', () => {
    const pasted = clipboardHtml(`
      <blockquote><em>Ship carefully</em><br>then verify</blockquote>
      <ol start="3"><li><strong>Build</strong></li><li>Check</li></ol>
      <table><tr><th>Owner</th><th>Status</th></tr><tr><td>Maya</td><td>Ready</td></tr></table>
    `)

    expect(pasted).toEqual({
      text: '> _Ship carefully_\n> then verify\n3. *Build*\n4. Check\nOwner\tStatus\nMaya\tReady',
      links: [],
    })
  })

  it('keeps Slack links and code blocks, and drops unsafe content', () => {
    const pasted = clipboardHtml(`
      <span data-stringify-type="paragraph">See <a href="https://example.com/guide" onclick="steal()">deployment guide</a></span>
      <pre>const answer = 42</pre>
      <a href="javascript:steal()">unsafe label</a><a href="data:text/html,bad">data label</a>
      <script>steal()</script><style>.secret { color: red }</style><img src="https://example.com/tracker.png" onerror="steal()">
    `)

    expect(pasted).toEqual({
      text: 'See deployment guide\n```\nconst answer = 42\n```\nunsafe labeldata label',
      links: [{ start: 4, end: 20, url: 'https://example.com/guide' }],
    })
  })

  it('leaves a link whose label is its URL as a plain URL', () => {
    expect(clipboardHtml('<a href="https://example.com/docs">https://example.com/docs</a>')).toEqual({
      text: 'https://example.com/docs',
      links: [],
    })
  })

  it('reads a large paste without turning it into typing work', () => {
    const paragraph = '<p><strong>Release note</strong> <a href="https://example.com/release">read more</a></p>'
    const html = (bytes: number) => paragraph.repeat(Math.ceil(bytes / paragraph.length))
    const pasted = clipboardHtml(html(200_000))
    expect(pasted.text.length).toBeGreaterThan(50_000)
    expect(pasted.links.length).toBeGreaterThan(1_000)
    expect(growth((bytes) => clipboardHtml(html(bytes)), 50_000)).toBeLessThan(10)
  })
})
