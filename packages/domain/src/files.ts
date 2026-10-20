/**
 * What a Slack file is, decided in one place: the message's preview label
 * (`filesLabel`), the sync's readiness check, the engine's `FileView` and the
 * media viewer all read it from here (SPEC section 8, "Images and the media
 * viewer" and "Other files"). Slack fills a fresh upload's type in as it
 * processes the file, so the type is read from `mimetype` when Slack has
 * one, else from Slack's short `filetype`, else from the name's extension. A
 * pasted screenshot named `x.png` is an image from its first copy, before
 * Slack says so. A tombstone, a clip recorded in Slack (`subtype`) and a
 * snippet (`mode`) say what they are before any type does.
 */

/**
 * How a file shows: `image` and `video` as pictures; `audio`, `pdf`, `html`
 * and `text` open in the viewer from their card; `file` is a card with
 * Quick Look; `deleted` is a file Slack no longer serves.
 */
export type FileMediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'text' | 'file' | 'deleted'

/** How the viewer draws a text file: Markdown rendered, CSV as a table, JSON and code in monospace, plain text wrapped. */
export type FileTextKind = 'markdown' | 'csv' | 'json' | 'code' | 'plain'

/** The fields of a file the kind is read from; every one may be missing. A decoded `@juno/slack-schema` `File` satisfies it. */
export interface TypedFile {
  readonly mimetype?: string | undefined
  readonly filetype?: string | undefined
  readonly name?: string | null | undefined
  readonly title?: string | null | undefined
  readonly pretty_type?: string | undefined
  readonly mode?: string | undefined
  readonly subtype?: string | undefined
  readonly file_access?: string | undefined
}

/** `mimetype` when Slack has worked it out: set and not empty. */
export function knownMimetype(file: TypedFile): string | undefined {
  const type = file.mimetype?.trim().toLowerCase()
  return type === undefined || type === '' ? undefined : type
}

/** The kind a file shows as; `file` when nothing says more. The generic binary type says nothing, so the name decides. */
export function fileMediaKind(file: TypedFile): FileMediaKind {
  if (file.mode === 'tombstone' || file.file_access === 'file_not_found') return 'deleted'
  if (file.subtype === 'slack_audio') return 'audio'
  if (file.subtype === 'slack_video') return 'video'
  if (file.mode === 'snippet') return 'text'
  const mimetype = essence(knownMimetype(file))
  if (mimetype !== undefined && mimetype !== 'application/octet-stream') return kindOfMimetype(mimetype)
  const filetype = file.filetype?.trim().toLowerCase()
  if (filetype !== undefined && filetype !== '') return KINDS_BY_TYPE[filetype] ?? 'file'
  return KINDS_BY_TYPE[extensionOf(file.name) ?? extensionOf(file.title) ?? ''] ?? 'file'
}

function essence(mimetype: string | undefined): string | undefined {
  return mimetype?.split(';')[0]!.trim()
}

/** Text types that are not for reading: an invite, a contact card. */
const NOT_TEXT_MIMETYPES = new Set(['text/calendar', 'text/vcard', 'text/x-vcard', 'text/rtf'])
const TEXT_MIMETYPES = new Set(['application/json', 'application/xml', 'application/x-yaml', 'application/yaml', 'application/javascript', 'application/x-sh', 'application/sql', 'application/toml'])

function kindOfMimetype(mimetype: string): FileMediaKind {
  if (mimetype === 'application/pdf') return 'pdf'
  if (mimetype === 'text/html') return 'html'
  if (NOT_TEXT_MIMETYPES.has(mimetype)) return 'file'
  if (mimetype.startsWith('text/') || TEXT_MIMETYPES.has(mimetype) || mimetype.endsWith('+json') || mimetype.endsWith('+xml')) return 'text'
  const family = mimetype.split('/')[0]
  return family === 'image' || family === 'video' || family === 'audio' ? family : 'file'
}

function extensionOf(name: string | null | undefined): string | undefined {
  if (name === undefined || name === null) return undefined
  const dot = name.lastIndexOf('.')
  return dot === -1 ? undefined : name.slice(dot + 1).trim().toLowerCase()
}

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

/** Slack's short `filetype` values and common extensions, by kind. */
const KINDS_BY_TYPE: Readonly<Record<string, FileMediaKind>> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', tif: 'image', tiff: 'image', heic: 'image', heif: 'image', svg: 'image', avif: 'image',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', mkv: 'video', avi: 'video', mpg: 'video', mpeg: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio', aiff: 'audio',
  pdf: 'pdf',
  html: 'html', htm: 'html',
  ...Object.fromEntries([...Object.keys(CODE_FILETYPES), ...Object.keys(CODE_EXTENSIONS), 'text', 'txt', 'log', 'markdown', 'md', 'csv', 'tsv', 'json', 'env', 'ini', 'cfg', 'conf'].map((type) => [type, 'text' as const])),
}

/**
 * How the viewer draws a text file, and for code the language it names in
 * the meta line: Slack's `pretty_type` ("Python"), else a name for its
 * `filetype`.
 */
export function fileTextKind(file: TypedFile): { readonly kind: FileTextKind; readonly language?: string } {
  const mimetype = essence(knownMimetype(file)) ?? ''
  const filetype = file.filetype?.trim().toLowerCase() ?? ''
  const extension = extensionOf(file.name) ?? extensionOf(file.title) ?? ''
  if (filetype === 'markdown' || mimetype === 'text/markdown' || extension === 'md' || extension === 'markdown') return { kind: 'markdown' }
  if (filetype === 'csv' || filetype === 'tsv' || mimetype === 'text/csv' || mimetype === 'text/tab-separated-values' || extension === 'csv' || extension === 'tsv') return { kind: 'csv' }
  if (filetype === 'json' || mimetype === 'application/json' || mimetype.endsWith('+json') || extension === 'json') return { kind: 'json' }
  const code = filetype in CODE_FILETYPES ? filetype : (filetype === '' || filetype === 'text' || filetype === 'auto' || filetype === 'binary' ? CODE_EXTENSIONS[extension] : undefined)
  if (code !== undefined) return { kind: 'code', language: (code === filetype ? file.pretty_type : undefined) || CODE_FILETYPES[code] || code }
  return { kind: 'plain' }
}

/** The kind a message's preview names a file by: "Voice clip", "Snippet: notes", "Canvas: plan". */
export type FileLabelKind = 'image' | 'video' | 'voice' | 'snippet' | 'canvas' | 'deleted' | 'file'

export function fileLabelKind(file: TypedFile): FileLabelKind {
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
