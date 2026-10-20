import { describe, expect, it } from 'vitest'
import { splitLanguageTag } from '../src/index'

describe('a language tag on the first line', () => {
  it('names the language and is not shown', () => {
    expect(splitLanguageTag('ts\nconst a = 1')).toEqual({ language: 'typescript', code: 'const a = 1' })
    expect(splitLanguageTag('Python\nprint(1)')).toEqual({ language: 'python', code: 'print(1)' })
    expect(splitLanguageTag('sh \nls -la')).toEqual({ language: 'bash', code: 'ls -la' })
  })

  it('can ask for no colours', () => {
    expect(splitLanguageTag('text\nconst a = 1')).toEqual({ language: 'plaintext', code: 'const a = 1' })
  })

  it('leaves a block alone when the line is not only a known tag', () => {
    expect(splitLanguageTag('ts is great\nreally')).toEqual({ code: 'ts is great\nreally' })
    expect(splitLanguageTag('banana\nsplit')).toEqual({ code: 'banana\nsplit' })
    expect(splitLanguageTag('const a = 1\nconst b = 2')).toEqual({ code: 'const a = 1\nconst b = 2' })
  })

  it('keeps a lone tag word as the text', () => {
    expect(splitLanguageTag('python')).toEqual({ code: 'python' })
    expect(splitLanguageTag('json\n\n')).toEqual({ code: 'json\n\n' })
  })
})
