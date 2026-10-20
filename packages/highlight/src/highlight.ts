/**
 * The highlighter: code text and an optional language in, coloured tokens
 * out. It carries highlight.js and its grammars (about 150 KB), so apps
 * load it lazily, off the main thread (`apps/desktop` runs it in a worker).
 */
import type { Element, ElementContent, Root } from 'hast'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createLowlight } from 'lowlight'
import { detectLanguage } from './detect'
import { languageOfTag, type CodeToken, type HighlightedCode, type SyntaxKind } from './index'


const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, graphql, ini, java, javascript, json, kotlin, less, lua, makefile,
  markdown, php, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
})

/**
 * Only this much of a block is coloured; the rest follows as plain text.
 * A block shows about seven lines before it scrolls, and drawing tens of
 * thousands of spans for lines nobody reads would cost the page.
 */
export const MAX_HIGHLIGHT_LENGTH = 12_000

/**
 * The kind of each highlight.js scope, by its first class name. `null`
 * keeps the parent's text colour (an interpolation inside a string is
 * code, not string). Scopes not listed pass their parent's kind through.
 */
const KINDS: Readonly<Record<string, SyntaxKind | null>> = {
  keyword: 'keyword',
  'template-tag': 'keyword',
  'variable.language': 'keyword',
  'selector-tag': 'tag',
  'selector-class': 'tag',
  'selector-id': 'tag',
  'selector-pseudo': 'tag',
  'selector-attr': 'tag',
  tag: 'punctuation',
  name: 'tag',
  string: 'string',
  regexp: 'string',
  char: 'string',
  code: 'string',
  number: 'number',
  comment: 'comment',
  quote: 'comment',
  doctag: 'comment',
  'title.function': 'function',
  'title.function.invoke': 'function',
  title: 'function',
  section: 'keyword',
  type: 'type',
  'title.class': 'type',
  'title.class.inherited': 'type',
  built_in: 'type',
  literal: 'constant',
  symbol: 'constant',
  bullet: 'constant',
  'variable.constant': 'constant',
  attr: 'property',
  attribute: 'property',
  property: 'property',
  punctuation: 'punctuation',
  operator: 'punctuation',
  meta: 'meta',
  'meta.prompt': 'meta',
  addition: 'inserted',
  deletion: 'deleted',
  subst: null,
  params: null,
}

/** The scope name of a highlight.js element: its classes without the `hljs-` prefix, joined back with dots. */
function scopeOf(element: Element): string | undefined {
  const names = element.properties['className']
  if (!Array.isArray(names) || names.length === 0) return undefined
  return names.map((name) => String(name).replace(/^hljs-/, '').replace(/_+$/, '')).join('.')
}

function kindOf(scope: string | undefined, parent: SyntaxKind | undefined): SyntaxKind | undefined {
  if (scope === undefined) return parent
  if (Object.hasOwn(KINDS, scope)) return KINDS[scope] ?? undefined
  // `title.function.invoke` → `title.function` → `title`.
  const dot = scope.lastIndexOf('.')
  return dot === -1 ? parent : kindOf(scope.slice(0, dot), parent)
}

/** Flattens the tree into runs, joining neighbours of the same kind. */
function flatten(nodes: ReadonlyArray<ElementContent>, parent: SyntaxKind | undefined, out: CodeToken[]): void {
  for (const node of nodes) {
    if (node.type === 'text') push(out, node.value, parent)
    else if (node.type === 'element') flatten(node.children, kindOf(scopeOf(node), parent), out)
  }
}

function push(out: CodeToken[], text: string, kind: SyntaxKind | undefined): void {
  if (text === '') return
  // Whitespace has no colour, so it joins whatever run it sits next to.
  const last = out.at(-1)
  if (last !== undefined && (last.kind === kind || text.trim() === '')) {
    out[out.length - 1] = last.kind === undefined ? { text: last.text + text } : { text: last.text + text, kind: last.kind }
    return
  }
  out.push(kind === undefined ? { text } : { text, kind })
}

/**
 * Colours a code block. `language` is a grammar name or a tag (`ts`, from
 * `splitLanguageTag` or a Juno bubble's fence); without one, or with one
 * no grammar knows, the language is detected. Returns undefined when the
 * block should stay plain: no confident language, `plaintext`, or nothing
 * coloured. Joined, the tokens' text is always `code`, so the coloured
 * block has the plain one's lines.
 */
export function highlightCode(code: string, language?: string): HighlightedCode | undefined {
  const named = language === undefined ? undefined : (languageOfTag(language) ?? (lowlight.registered(language) ? language : undefined))
  const lang = named ?? detectLanguage(code)
  if (lang === undefined || lang === 'plaintext' || !lowlight.registered(lang)) return undefined
  let head = code
  let tail = ''
  if (code.length > MAX_HIGHLIGHT_LENGTH) {
    const cut = code.lastIndexOf('\n', MAX_HIGHLIGHT_LENGTH)
    const at = cut > 0 ? cut : MAX_HIGHLIGHT_LENGTH
    head = code.slice(0, at)
    tail = code.slice(at)
  }
  let tree: Root
  try {
    tree = lowlight.highlight(lang, head)
  } catch {
    return undefined
  }
  const tokens: CodeToken[] = []
  flatten(tree.children as ReadonlyArray<ElementContent>, undefined, tokens)
  if (tail !== '') push(tokens, tail, undefined)
  if (!tokens.some((token) => token.kind !== undefined)) return undefined
  return { language: lang, tokens }
}
