/**
 * Guesses a code block's language when it has no tag. Wrong colours read
 * worse than none, so it answers only when the text is clearly one
 * language, and never for prose, logs, stack traces or compiler output,
 * which Slack users paste into code blocks as often as code.
 *
 * The rules are cheap regular expressions, tested once each on the first
 * `SAMPLE` characters: highlight.js's own detection runs every grammar
 * over the text and scored prose and stack traces as high as real code.
 */

/** Detection reads at most this much of a block. */
const SAMPLE = 4000

/** A weighted clue that the text is in a language. */
type Signal = readonly [RegExp, number]

/** A language wins with at least this score... */
const MIN_SCORE = 4
/** ...and this many times the runner-up's. */
const MIN_LEAD = 1.5
/** Text that reads as sentences needs this score instead. */
const MIN_SCORE_PROSE = 7

const SIGNALS: ReadonlyArray<readonly [string, ReadonlyArray<Signal>]> = [
  // JavaScript is coloured as TypeScript: the grammar is a superset, and the two are hard to tell apart.
  ['typescript', [
    [/^\s*((import|export)\s.+\sfrom\s+['"]|import\s+['"][^'"]+['"]|export\s+(default|const|let|function|async|class|interface|type|enum)\b|export\s*\{)/m, 3],
    [/^\s*(const|let|var)\s+[\w${}[\],\s]+(:\s*[\w<>[\]|.]+\s*)?=(?!=)/m, 2],
    [/^\s*(export\s+)?(interface|type)\s+[A-Z]\w*(<[^>]*>)?\s*(=|\{|extends)/m, 3],
    [/:\s*(string|number|boolean|void|unknown|never|Promise<|ReadonlyArray<|Array<|Record<)/, 3],
    [/\breadonly\s+\w+\s*\??:/, 3],
    [/^\s*(export\s+)?(const\s+)?enum\s+\w+\s*\{/m, 3],
    [/\b(async\s+)?function\s*\*?\s*\w*\s*\([^)]*\)\s*(:\s*[^{]+)?\{/, 2],
    [/\(([\w$,\s]*|\{[^}]*\})\)\s*=>/, 2],
    [/\(\s*\{[^}]*\}\s*:\s*[\w{]/, 3],
    [/^\s*return\s+<\w/m, 3],
    [/\bclassName=/, 2],
    // JSX: an attribute set from code, or spread props.
    [/\s[\w-]+=\{/, 3],
    [/\{\.\.\.[\w.]+(\([^)]*\))?\}/, 2],
    [/\b(console\.\w+\(|document\.\w+|window\.\w+|require\(['"]|module\.exports|JSON\.(parse|stringify)\(|\.then\(|await\s+\w)/, 2],
    [/===|!==/, 1],
  ]],
  ['python', [
    [/^\s*(async\s+)?def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/m, 4],
    [/^\s*class\s+\w+(\(.*\))?:\s*$/m, 4],
    [/^\s*(import\s+[\w.]+(\s+as\s+\w+)?\s*$|from\s+[\w.]+\s+import\s+)/m, 3],
    [/^>>> /m, 4],
    [/^@[\w.]+(\(.*\))?\s*$/m, 1],
    [/\bself\.\w+/, 2],
    [/^\s*(if|elif|for|while|with|try|except|else)\b.*:\s*$/m, 2],
    [/:\s*\n(\s{2,}|\t)\S/, 1],
    [/\b(print|len|range|isinstance)\(/, 1],
    [/\b(None|True|False)\b/, 1],
    [/"""|'''/, 1],
  ]],
  ['sql', [
    [/^\s*(select\s[\s\S]+?\sfrom\s|insert\s+into\s|update\s+\w+\s+set\s|delete\s+from\s|create\s+(table|(unique\s+)?index|view)\s|alter\s+table\s|drop\s+table\s|with\s+\w+\s+as\s*\()/im, 5],
    [/\b(where|join|group\s+by|order\s+by|limit|values|having|returning)\b/i, 1],
  ]],
  ['bash', [
    [/^#!\/\S*\b(ba|z)?sh\b/m, 5],
    [/\bset\s+-[euxo]+\b/, 2],
    [/^\s*(for|while|if)\b.*;\s*(do|then)\s*$/m, 3],
    [/^\s*(fi|done|esac)\s*$/m, 2],
    [/\$\{?\w+\}?/, 1],
  ]],
  ['go', [
    [/^\s*package\s+\w+\s*$/m, 4],
    [/^\s*func\s+(\(\s*\w+\s+\*?\w+\s*\)\s*)?\w+\s*\(/m, 4],
    [/^\s*type\s+\w+\s+(struct|interface)\s*\{/m, 4],
    [/\bif\s+err\s*!=\s*nil\b|\bfmt\.\w+\(|\w\s*:=\s*\S/, 3],
  ]],
  ['rust', [
    [/^\s*(pub\s+)?(async\s+)?fn\s+\w+\s*(<[^>]*>)?\s*\(/m, 4],
    [/^\s*impl(<[^>]*>)?\s+[\w:<>]+(\s+for\s+\w+)?\s*\{/m, 4],
    [/\blet\s+(mut\s+)?\w+(\s*:\s*[\w<>]+)?\s*=/, 2],
    [/\b(println!|vec!|format!|write!|use\s+\w+::|&mut\s|&self\b|Option<|Result<|Some\(|Ok\()/, 3],
  ]],
  ['yaml', [
    [/^[a-z_][\w.-]*:\s*$/m, 2],
    [/^\s{2,}[a-z_][\w.-]*:\s+\S/m, 2],
    [/^\s*-\s+([a-z_][\w.-]*:\s|["\w])/m, 1],
    [/^(apiVersion|kind|services|jobs|steps|name|on|version):/m, 1],
  ]],
  ['diff', [
    [/^(---|\+\+\+)\s+\S/m, 3],
    [/^@@\s+-\d+(,\d+)?\s+\+\d+(,\d+)?\s+@@/m, 5],
    [/^diff --git /m, 5],
  ]],
  ['css', [
    // A selector line; not an object key (`body: {`).
    [/^(?!.*:\s*\{\s*$)\s*[.#:]?[\w-][\w\s.#:>~+\-[\]="()]*\{\s*$/m, 2],
    [/(^|[{;]\s*)[a-z-]+\s*:\s*[^;{}\n]+;/m, 2],
    [/:\s*[^;\n]*(\bvar\(--[\w-]+\)|!important|\b\d+(px|rem|em))[^;\n]*;/, 2],
    [/^\s*@(media|import|keyframes|font-face|supports)\b/m, 3],
  ]],
  ['xml', [
    [/^\s*<(!DOCTYPE|\?xml|html|head|body|div|span|p|a|ul|ol|li|section|svg|template|script|style|button|form|input|img|table)\b[^>]*>/im, 3],
    [/<\/[a-z][\w-]*>/i, 2],
  ]],
  ['java', [
    [/\b(public|private|protected)\s+(static\s+)?(final\s+)?(abstract\s+)?(class|interface|enum)\s+[A-Z]\w*|\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>[\]]+\s+\w+\s*[(=;]/, 4],
    [/\bSystem\.out\.print|^\s*@Override\b|^\s*import\s+java\./m, 3],
  ]],
]

/**
 * Shapes that read as text even when some grammar scores them: stack
 * frames, tracebacks, compiler and test output, log lines.
 */
const PLAIN_SHAPES: ReadonlyArray<RegExp> = [
  /^\s+at\s+\S.*[(:]\d+[:)]/m, // a JavaScript or Java stack frame
  /^Traceback \(most recent call last\)/m,
  /^\s*File "[^"]+", line \d+/m,
  /^Exception in thread /m,
  /^goroutine \d+ \[/m,
  /^panic: /m,
  /^(error|warning)(\[\w+\])?: /m, // rustc
  /^\s*--> \S+:\d+:\d+/m,
  /\(\d+,\d+\): error TS\d+:/,
  /^\s*(FAIL|PASS)\s+\S/m,
  /^[\w.]*(Error|Exception):\s/m,
  /^npm (ERR!|error|warn)\s/m,
  /^HTTP\/\d(\.\d)? \d{3}\b/m,
  /^commit [0-9a-f]{7,40}\b/m,
  /^#\d+ \[/m, // docker build steps
]

/** A log line starts with a date, a time or a level. */
const LOG_LINE = /^(\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\[?\d{2}:\d{2}:\d{2}|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}|\[?(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL|info|warn|error|debug)\]?[\s:])/

const COMMANDS = [
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'node', 'deno', 'curl', 'wget', 'kubectl', 'helm', 'docker', 'podman',
  'brew', 'apt', 'apt-get', 'yum', 'dnf', 'ssh', 'scp', 'rsync', 'cd', 'ls', 'cat', 'echo', 'grep', 'rg',
  'find', 'sed', 'awk', 'mkdir', 'rm', 'mv', 'cp', 'chmod', 'chown', 'tar', 'gzip', 'make', 'cargo', 'go', 'pip', 'pip3',
  'python', 'python3', 'uv', 'poetry', 'terraform', 'aws', 'gcloud', 'az', 'gh', 'psql', 'redis-cli', 'systemctl',
  'journalctl', 'kill', 'pkill', 'source', 'touch', 'ln', 'unzip', 'open', 'xcode-select', 'defaults', 'launchctl', 'which',
  'tail', 'head', 'jq', 'xargs', 'ps', 'lsof', 'ping', 'dig', 'openssl', 'tsc', 'vitest', 'jest', 'eslint', 'prettier',
]
/** Commands that are also English words: "go ahead", "make sense" and "source of truth" are not commands. */
const WORD_COMMANDS = new Set([
  'source', 'go', 'make', 'open', 'find', 'head', 'tail', 'kill', 'which', 'touch', 'cat', 'cd', 'echo', 'ln', 'rm', 'cp', 'mv',
  'apt', 'bun', 'node', 'uv', 'ping', 'dig', 'defaults', 'tar', 'yarn', 'brew', 'helm', 'python', 'python3', 'pip', 'pip3',
  'jest', 'deno', 'ps', 'poetry',
])
/** Subcommands that make a line a command: `make build`, `go test`, `brew install`. */
const SUBCOMMANDS = new Set([
  'install', 'i', 'add', 'remove', 'uninstall', 'run', 'build', 'test', 'start', 'dev', 'lint', 'check', 'init', 'update',
  'upgrade', 'status', 'commit', 'push', 'pull', 'fetch', 'clone', 'checkout', 'switch', 'rebase', 'merge', 'log', 'diff',
  'stash', 'reset', 'branch', 'exec', 'get', 'apply', 'describe', 'delete', 'logs', 'compose', 'mod', 'fmt', 'plan', 'list',
  'show', 'clean', 'ci', 'publish', 'login', 'auth', 'version', 'release', 'serve', 'watch', 'bench', 'dlx', 'tidy', 'vet',
])
const COMMAND_START = new RegExp(`^\\s*(\\$\\s+)?(sudo\\s+)?(${COMMANDS.map((c) => c.replace(/[-]/g, '\\-')).join('|')})(?=\\s|$)(.*)$`)
/** What only a command line has: a flag, a path, a file name, a pipe or redirect, a variable or an assignment. */
const SHELL_SHAPE = /(^|\s)-{1,2}[A-Za-z0-9]|[~.]?\/|\w\.\w|\||&&|\s>{1,2}\s|\$|=/
const PROMPT_LINE = /^\s*\$\s+\S/
const COMMENT_LINE = /^\s*#/
/** A line that goes on in the next one. */
const CONTINUES = /(\\|\||&&)\s*$/

/**
 * A line that is a shell command: a known command, and something only a
 * command has. A prompt (`$ `), a flag, a path, a pipe or an `=` will do.
 * So will a known subcommand (`git status`), but after a command that is
 * also an English word, only in a line of three words or fewer
 * (`make build`, not "go check it out"). A non-word command (`kubectl`)
 * needs any argument. `export` counts only as `export NAME=`.
 */
function isCommandLine(line: string): boolean {
  if (/^\s*(\$\s+)?export\s+[A-Za-z_]\w*=/.test(line)) return true
  const match = COMMAND_START.exec(line)
  if (match === null) return false
  const [, prompt, , command, rest = ''] = match
  const args = rest.trim().split(/\s+/).filter((arg) => arg !== '')
  if (prompt !== undefined || SHELL_SHAPE.test(rest)) return true
  if (!WORD_COMMANDS.has(command!)) return args.length > 0
  return args.length > 0 && args.length <= 2 && SUBCOMMANDS.has(args[0]!)
}

/** A plain word, with the punctuation prose puts around it. */
const WORD = /^[("'“]?[A-Za-z][a-z']*[)"'”,.!?:;]?$/

/**
 * Text that reads as sentences: most of its tokens are plain words, not
 * names with dots, underscores, flags, paths or brackets.
 */
function readsAsProse(text: string): boolean {
  const tokens = text.split(/\s+/).filter((token) => token !== '')
  if (tokens.length < 5) return false
  return tokens.filter((token) => WORD.test(token)).length / tokens.length >= 0.8
}

/** A block of a few plain words: "source of truth", "go ahead". Short blocks meet a higher bar. */
function isPhrase(text: string): boolean {
  const tokens = text.split(/\s+/).filter((token) => token !== '')
  return tokens.length < 5 && tokens.every((token) => WORD.test(token))
}

/**
 * A unified diff: file headers (`---` and `+++`) or a hunk (`@@ -1,4 +1,4 @@`),
 * and changed lines. Its structure wins over the language of its lines.
 */
function isDiff(text: string): boolean {
  if (/^diff --git /m.test(text)) return true
  const headers = /^--- \S/m.test(text) && /^\+\+\+ \S/m.test(text)
  const hunk = /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text)
  return (headers || hunk) && /^[+-](?!(--|\+\+) )/m.test(text)
}

/**
 * The language of an untagged code block, as a highlight.js grammar name,
 * or undefined when the text is not clearly code in one known language.
 */
export function detectLanguage(code: string): string | undefined {
  const text = code.length > SAMPLE ? code.slice(0, SAMPLE) : code
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return undefined
  if (isDiff(text)) return 'diff'
  if (PLAIN_SHAPES.some((shape) => shape.test(text))) return undefined
  if (lines.filter((line) => LOG_LINE.test(line)).length * 2 >= lines.length) return undefined

  const trimmed = text.trim()
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && code.length <= SAMPLE && isJson(trimmed)) return 'json'

  const scores = SIGNALS.map(([language, signals]) => {
    let score = 0
    for (const [pattern, weight] of signals) if (pattern.test(text)) score += weight
    return [language, score] as const
  }).toSorted((a, b) => b[1] - a[1])
  const [best, top] = scores[0]!
  const second = scores[1]![1]

  // Every line a command, with comments between and continued lines: a
  // terminal session or a script of commands. Code that a language's own
  // rules recognise wins (`export function`, `go func`).
  if (top < MIN_SCORE && isCommands(lines) && !readsAsProse(text)) {
    return lines.some((line) => PROMPT_LINE.test(line)) ? 'shell' : 'bash'
  }

  if (isPhrase(text) || top < MIN_SCORE || top < second * MIN_LEAD) return undefined
  if (top < MIN_SCORE_PROSE && readsAsProse(text)) return undefined
  return best
}

function isCommands(lines: ReadonlyArray<string>): boolean {
  let commands = 0
  let continued = false
  for (const line of lines) {
    if (continued) {
      continued = CONTINUES.test(line)
      continue
    }
    if (COMMENT_LINE.test(line)) continue
    if (!isCommandLine(line)) return false
    commands++
    continued = CONTINUES.test(line)
  }
  return commands > 0 && lines.some((line) => !COMMENT_LINE.test(line) && /\s\S/.test(line.trim()))
}


function isJson(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}
