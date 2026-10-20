/**
 * The small half of `@juno/highlight`: the token types, the language names
 * a code block may be tagged with, and the rule that reads a tag line
 * (`@juno/richtext` applies it). It imports no grammar. The highlighter is
 * `@juno/highlight/highlight`; `@juno/highlight/paint` puts its tokens on
 * the page.
 */

/** What a token is, for its colour. Each kind has a `--syntax-<kind>` token. */
export type SyntaxKind =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'constant'
  | 'property'
  | 'tag'
  | 'punctuation'
  | 'meta'
  | 'inserted'
  | 'deleted'

/** A run of code text. A run without a kind takes the block's text colour. */
export interface CodeToken {
  readonly text: string
  readonly kind?: SyntaxKind
}

/** A code block in tokens. Joined, the tokens' text is the code as given. */
export interface HighlightedCode {
  readonly language: string
  readonly tokens: ReadonlyArray<CodeToken>
}

/**
 * The language each tag names, by lowercase tag. Values are highlight.js
 * grammar names; `plaintext` means the writer asked for no colours.
 */
const TAGS: Readonly<Record<string, string>> = {
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', javascript: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  py: 'python', python: 'python', python3: 'python', py3: 'python',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', pgsql: 'sql', mysql: 'sql', sqlite: 'sql', plsql: 'sql',
  json: 'json', jsonc: 'json', json5: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash',
  console: 'shell', terminal: 'shell', 'shell-session': 'shell',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
  yml: 'yaml', yaml: 'yaml',
  diff: 'diff', patch: 'diff',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xhtml: 'xml', xml: 'xml', svg: 'xml',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin', kotlin: 'kotlin',
  swift: 'swift',
  c: 'c', h: 'c',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
  rb: 'ruby', ruby: 'ruby',
  php: 'php',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  ini: 'ini', toml: 'ini',
  md: 'markdown', markdown: 'markdown',
  graphql: 'graphql', gql: 'graphql',
  make: 'makefile', makefile: 'makefile', mk: 'makefile',
  lua: 'lua',
  text: 'plaintext', txt: 'plaintext', plain: 'plaintext', plaintext: 'plaintext',
}

/** The language a tag names (`ts`, `Python`, `sh`), or undefined for a word that is not a tag. */
export function languageOfTag(tag: string): string | undefined {
  return Object.hasOwn(TAGS, tag.toLowerCase()) ? TAGS[tag.toLowerCase()] : undefined
}

/** A code block split into its language tag, when its first line is one, and the code to show. */
export interface CodeParts {
  readonly language?: string
  readonly code: string
}

/**
 * Reads the first line of a code block as a language tag, the Discord
 * convention: a block that starts with a line holding only `ts`, `python`
 * or `sh` (after the fence, which Slack has already dropped) is that
 * language, and the line is not shown. Anything else on the line, or no
 * code after it, leaves the block as written.
 */
export function splitLanguageTag(text: string): CodeParts {
  const newline = text.indexOf('\n')
  if (newline === -1) return { code: text }
  const tag = languageOfTag(text.slice(0, newline).trim())
  const rest = text.slice(newline + 1)
  if (tag === undefined || rest.trim() === '') return { code: text }
  return { language: tag, code: rest }
}
