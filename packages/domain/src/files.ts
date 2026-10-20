/**
 * What a Slack file is, decided in one place: the message's preview label
 * (`filesLabel`), the engine's `FileView` and the media viewer all read it
 * from here (SPEC section 8, "Images and the media viewer" and "Other
 * files"). The rules read Slack's `mimetype`, `filetype`, `mode`,
 * `subtype` and the file's name, in that order of trust.
 */

/** The fields of a Slack file these rules read. A decoded `@juno/slack-schema` `File` satisfies it. */
export interface FileFacts {
  readonly name?: string | null
  readonly title?: string | null
  readonly mimetype?: string
  readonly filetype?: string
  readonly pretty_type?: string
  readonly mode?: string
  readonly subtype?: string
  readonly file_access?: string
}

/**
 * How a file shows: `image` and `video` as pictures; `audio`, `pdf`, `html`
 * and `text` open in the viewer from their card; `file` is a card with
 * Quick Look; `deleted` is a file Slack no longer serves.
 */
export type FileMediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'text' | 'file' | 'deleted'

/** How the viewer draws a text file: Markdown rendered, CSV as a table, JSON and code in monospace, plain text wrapped. */
export type FileTextKind = 'markdown' | 'csv' | 'json' | 'code' | 'plain'

/** Slack's `filetype` for code, and the language a reader knows it by when Slack sends no `pretty_type`. */
const CODE_FILETYPES: Readonly<Record<string, string>> = {
  applescript: 'AppleScript',
  boxnote: 'Text',
  c: 'C',
  csharp: 'C#',
  cpp: 'C++',
  css: 'CSS',
  clojure: 'Clojure',
  coffeescript: 'CoffeeScript',
  d: 'D',
  dart: 'Dart',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  elixir: 'Elixir',
  erlang: 'Erlang',
  fsharp: 'F#',
  go: 'Go',
  groovy: 'Groovy',
  haskell: 'Haskell',
  java: 'Java',
  javascript: 'JavaScript',
  julia: 'Julia',
  kotlin: 'Kotlin',
  latex: 'LaTeX',
  lisp: 'Lisp',
  lua: 'Lua',
  matlab: 'MATLAB',
  objc: 'Objective-C',
  ocaml: 'OCaml',
  perl: 'Perl',
  php: 'PHP',
  powershell: 'PowerShell',
  puppet: 'Puppet',
  python: 'Python',
  r: 'R',
  ruby: 'Ruby',
  rust: 'Rust',
  sass: 'Sass',
  scala: 'Scala',
  scheme: 'Scheme',
  shell: 'Shell',
  smalltalk: 'Smalltalk',
  sql: 'SQL',
  swift: 'Swift',
  toml: 'TOML',
  tsx: 'TSX',
  typescript: 'TypeScript',
  vb: 'Visual Basic',
  vbscript: 'VBScript',
  verilog: 'Verilog',
  vhdl: 'VHDL',
  xml: 'XML',
  yaml: 'YAML',
}

/** Code by the name's extension, for a file Slack typed as plain text or binary. */
const CODE_EXTENSIONS: Readonly<Record<string, string>> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  h: 'c',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  kt: 'kotlin',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
}

/** Text a reader opens as is: logs, notes and the like. */
const PLAIN_EXTENSIONS = new Set(['txt', 'text', 'log', 'env', 'ini', 'cfg', 'conf'])
const TEXT_MIMETYPES = new Set(['application/json', 'application/xml', 'application/x-yaml', 'application/yaml', 'application/javascript', 'application/x-sh', 'application/sql', 'application/toml'])
/** `text/` types that are not for reading: an invite, a contact card. */
const NOT_TEXT_MIMETYPES = new Set(['text/calendar', 'text/vcard', 'text/x-vcard', 'text/rtf'])

function extensionOf(file: FileFacts): string {
  const name = file.name || file.title || ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function mimetypeOf(file: FileFacts): string {
  return (file.mimetype ?? '').split(';')[0]!.trim().toLowerCase()
}

/** Whether the file is text the viewer can show, from its type, Slack's filetype or its name. */
function isText(file: FileFacts): boolean {
  if (file.mode === 'snippet') return true
  const mimetype = mimetypeOf(file)
  if (NOT_TEXT_MIMETYPES.has(mimetype)) return false
  if (mimetype.startsWith('text/') || TEXT_MIMETYPES.has(mimetype) || mimetype.endsWith('+json') || mimetype.endsWith('+xml')) return true
  const filetype = file.filetype ?? ''
  if (['text', 'markdown', 'csv', 'tsv', 'json'].includes(filetype) || filetype in CODE_FILETYPES) return true
  if (mimetype !== '' && mimetype !== 'application/octet-stream') return false
  const extension = extensionOf(file)
  return PLAIN_EXTENSIONS.has(extension) || extension in CODE_EXTENSIONS || ['md', 'markdown', 'csv', 'tsv', 'json'].includes(extension)
}

/** How a file shows in the message and the viewer. */
export function fileMediaKind(file: FileFacts): FileMediaKind {
  if (file.mode === 'tombstone' || file.file_access === 'file_not_found') return 'deleted'
  if (file.subtype === 'slack_audio') return 'audio'
  if (file.subtype === 'slack_video') return 'video'
  const mimetype = mimetypeOf(file)
  if (file.mode !== 'snippet') {
    if (mimetype.startsWith('image/')) return 'image'
    if (mimetype.startsWith('video/')) return 'video'
    if (mimetype.startsWith('audio/')) return 'audio'
    if (mimetype === 'application/pdf' || file.filetype === 'pdf') return 'pdf'
    if (mimetype === 'text/html' || file.filetype === 'html' || (mimetype === '' && ['html', 'htm'].includes(extensionOf(file)))) return 'html'
  }
  return isText(file) ? 'text' : 'file'
}

/**
 * How the viewer draws a text file, and for code the language it names in
 * the meta line: Slack's `pretty_type` ("Python"), else a name for its
 * `filetype`.
 */
export function fileTextKind(file: FileFacts): { readonly kind: FileTextKind; readonly language?: string } {
  const mimetype = mimetypeOf(file)
  const filetype = file.filetype ?? ''
  const extension = extensionOf(file)
  if (filetype === 'markdown' || mimetype === 'text/markdown' || extension === 'md' || extension === 'markdown') return { kind: 'markdown' }
  if (filetype === 'csv' || filetype === 'tsv' || mimetype === 'text/csv' || mimetype === 'text/tab-separated-values' || extension === 'csv' || extension === 'tsv') return { kind: 'csv' }
  if (filetype === 'json' || mimetype === 'application/json' || mimetype.endsWith('+json') || extension === 'json') return { kind: 'json' }
  const code = filetype in CODE_FILETYPES ? filetype : (filetype === '' || filetype === 'text' || filetype === 'auto' || filetype === 'binary' ? CODE_EXTENSIONS[extension] : undefined)
  if (code !== undefined) return { kind: 'code', language: (code === filetype ? file.pretty_type : undefined) || CODE_FILETYPES[code] || code }
  return { kind: 'plain' }
}

/** The kind a message's preview names a file by: "Voice clip", "Snippet: notes", "Canvas: plan". */
export type FileLabelKind = 'image' | 'video' | 'voice' | 'snippet' | 'canvas' | 'deleted' | 'file'

export function fileLabelKind(file: FileFacts): FileLabelKind {
  if (file.subtype === 'slack_audio' && file.mode !== 'tombstone' && file.file_access !== 'file_not_found') return 'voice'
  const kind = fileMediaKind(file)
  if (kind === 'deleted' || kind === 'image' || kind === 'video') return kind
  if (file.mode === 'snippet') return 'snippet'
  if (file.filetype === 'quip' || file.filetype === 'canvas') return 'canvas'
  return 'file'
}

/**
 * The rows of a CSV or TSV file, as RFC 4180 reads them: fields split on the
 * delimiter, double quotes around a field that holds one, and `""` for a
 * quote inside it. The delimiter is a tab when the first line has tabs and
 * no commas. Reads at most `maxRows` rows; `more` says whether the text has
 * others after them.
 */
export function csvRows(text: string, maxRows: number): { readonly rows: ReadonlyArray<ReadonlyArray<string>>; readonly more: boolean } {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ','
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let field = ''
  let quoted = false
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const endRow = () => {
    row.push(field)
    rows.push(row)
    row = []
    field = ''
  }
  while (at < text.length) {
    const char = text[at]!
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"'
        at += 2
        continue
      }
      if (char === '"') quoted = false
      else field += char
      at++
      continue
    }
    if (char === '"' && field === '') quoted = true
    else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      endRow()
      if (char === '\r' && text[at + 1] === '\n') at++
      if (rows.length === maxRows) return { rows, more: text.slice(at + 1).trim() !== '' }
    } else field += char
    at++
  }
  if (field !== '' || row.length > 0) endRow()
  return { rows, more: false }
}
