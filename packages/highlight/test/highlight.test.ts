import { describe, expect, it } from 'bun:test'
import { highlightCode, MAX_HIGHLIGHT_LENGTH } from '../src/highlight'

const joined = (tokens: ReadonlyArray<{ readonly text: string }>) => tokens.map((token) => token.text).join('')

describe('highlighting', () => {
  it('colours a tagged block and keeps its text', () => {
    const code = `const name: string = 'Juno' // a comment\nexport function hello() { return 42 }`
    const result = highlightCode(code, 'typescript')
    expect(result?.language).toBe('typescript')
    expect(joined(result!.tokens)).toBe(code)
    const kinds = new Map(result!.tokens.map((token) => [token.text.trim(), token.kind]))
    expect(kinds.get('const')).toBe('keyword')
    expect(kinds.get("'Juno'")).toBe('string')
    expect(kinds.get('42')).toBe('number')
    expect(kinds.get('// a comment')).toBe('comment')
    expect(kinds.get('hello')).toBe('function')
  })

  it('leaves prose and plaintext uncoloured', () => {
    expect(highlightCode('Can someone review my pull request today, please?')).toBeUndefined()
    expect(highlightCode('const a = 1', 'plaintext')).toBeUndefined()
  })

  it('reads a tag as its language, and detects past a name it does not know', () => {
    expect(highlightCode('x = 1', 'py')?.language).toBe('python')
    expect(highlightCode('SELECT id FROM users WHERE active;', 'mermaid')?.language).toBe('sql')
    expect(highlightCode('Can someone review my pull request today, please?', 'mermaid')).toBeUndefined()
  })

  it('colours only the start of a very long block', () => {
    const line = 'const value = compute(1, "two") // note\n'
    const code = line.repeat(Math.ceil((MAX_HIGHLIGHT_LENGTH * 2) / line.length))
    const result = highlightCode(code, 'typescript')!
    expect(joined(result.tokens)).toBe(code)
    expect(result.tokens.at(-1)?.kind).toBeUndefined()
    expect(result.tokens.at(-1)!.text.length).toBeGreaterThan(MAX_HIGHLIGHT_LENGTH / 2)
  })
})
