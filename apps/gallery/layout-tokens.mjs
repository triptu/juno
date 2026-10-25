// Which design tokens a walk record depends on. A state's boxes can move only
// through tokens its code reads, and only through values that are not paint:
// a colour or a shadow never changes a layout box (the guard compares offset
// boxes and layout-shift entries). So a record keys on the read tokens'
// values, without colours and shadows, and not on the token files.

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const ts = createRequire(import.meta.url)('typescript-5')

export const tokenFiles = ['packages/tokens/src/tokens.stylex.ts', 'packages/tokens/src/themes.stylex.ts']

/**
 * The token part of walk keys over a repository: `structure` (the token files
 * without their values) and `key(files)`, the values of the layout tokens
 * those files read and of the tokens those values read.
 */
export function layoutTokens(root, files, graph) {
  const { tokens, structure } = parseTokens(tokenFiles.filter(file => files.has(file)).map(file => [file, readFileSync(join(root, file), 'utf8')]))
  const paint = paintTokens(tokens)
  const reads = new Map()
  const readsOf = file => {
    if (!reads.has(file)) {
      reads.set(file, /\.(ts|tsx|mjs|js|css|html)$/.test(file) && existsSync(join(root, file))
        ? tokenReads(readFileSync(join(root, file), 'utf8'), specifier => graph.resolveImport(file, specifier), tokens)
        : {})
    }
    return reads.get(file)
  }
  const key = inputs => {
    const read = new Set()
    const add = name => {
      if (read.has(name)) return
      read.add(name)
      // A paint value cannot move a box, whatever it reads.
      if (!paint.has(name)) for (const next of tokens.get(name).reads) add(next)
    }
    for (const file of inputs) {
      if (tokenFiles.includes(file)) continue
      const { all, names = [], prefixes = new Set(), groups = new Set() } = readsOf(file)
      if (all || prefixes.size > 0 || groups.size > 0) {
        for (const [name, token] of tokens) {
          if (all || groups.has(token.group) || [...prefixes].some(prefix => name.startsWith(prefix))) add(name)
        }
      }
      for (const name of names) add(name)
    }
    return [...read].filter(name => !paint.has(name)).toSorted().map(name => [name, tokens.get(name).values])
  }
  return { structure, key }
}

const closers = { '(': ')', '[': ']', '{': '}' }

/** The index after the string, template or comment that starts at `i`, or `i` when none does. */
function skip(text, i) {
  const char = text[i]
  if (char === '/' && text[i + 1] === '/') return text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i)
  if (char === '/' && text[i + 1] === '*') return text.indexOf('*/', i + 2) + 2
  if (char === "'" || char === '"') {
    let at = i + 1
    while (at < text.length && text[at] !== char) at += text[at] === '\\' ? 2 : 1
    return at + 1
  }
  if (char === '`') {
    let at = i + 1
    while (at < text.length && text[at] !== '`') {
      if (text[at] === '\\') at += 2
      else if (text[at] === '$' && text[at + 1] === '{') at = matching(text, at + 1) + 1
      else at++
    }
    return at + 1
  }
  return i
}

/** The index of the bracket that closes the one at `open`. */
function matching(text, open) {
  const stack = [closers[text[open]]]
  for (let at = open + 1; at < text.length;) {
    const after = skip(text, at)
    if (after !== at) { at = after; continue }
    if (closers[text[at]]) stack.push(closers[text[at]])
    else if (text[at] === stack.at(-1) && stack.pop() && stack.length === 0) return at
    at++
  }
  throw new Error(`unbalanced ${text[open]} at ${open}`)
}

/** `text` split at top-level `separator` characters. */
function split(text, separator) {
  const parts = []
  let depth = 0, from = 0
  for (let at = 0; at < text.length;) {
    const after = skip(text, at)
    if (after !== at) { at = after; continue }
    if (closers[text[at]]) depth++
    else if (')]}'.includes(text[at])) depth--
    else if (depth === 0 && text[at] === separator) { parts.push(text.slice(from, at)); from = at + 1 }
    at++
  }
  return [...parts, text.slice(from)]
}

const withoutComments = text => {
  let out = ''
  for (let at = 0; at < text.length;) {
    const after = skip(text, at)
    if (after !== at && text[at] === '/') { out += ' '; at = after; continue }
    out += text.slice(at, Math.max(after, at + 1))
    at = Math.max(after, at + 1)
  }
  return out
}

const tokenEntry = /^\s*(['"])(--[\w-]+)\1\s*:\s*([\s\S]*?)\s*$/

/**
 * The tokens of the two token files: each name's value and theme overrides,
 * plus everything else in the files (imports, constants, exports), which
 * every record keys on.
 */
function parseTokens(sources) {
  const tokens = new Map()
  let structure = ''
  for (const [file, source] of sources) {
    const text = withoutComments(source)
    let last = 0
    for (const match of text.matchAll(/(?:const\s+(\w+)\s*=\s*)?stylex\.(defineVars|createTheme)\(\s*(?:(\w+)\s*,\s*)?\{/g)) {
      if (match.index < last) continue
      const open = match.index + match[0].length - 1
      const close = matching(text, open)
      structure += text.slice(last, open + 1)
      for (const part of split(text.slice(open + 1, close), ',')) {
        const entry = tokenEntry.exec(part)
        // Anything but a plain `'--name': value` entry (a spread, a computed key) keys every record.
        if (!entry) { structure += part; continue }
        const value = entry[3].replace(/\s+/g, ' ')
        if (!tokens.has(entry[2])) tokens.set(entry[2], { values: [] })
        const token = tokens.get(entry[2])
        if (match[2] === 'defineVars') token.group = match[1]
        token.values.push([match[2] === 'defineVars' ? 'default' : match[1], value])
      }
      last = close
    }
    structure += `\n${file}\n${text.slice(last)}`
  }
  for (const token of tokens.values()) {
    token.reads = new Set(token.values.flatMap(([, value]) => value.match(/--[\w-]+/g) ?? []).filter(name => tokens.has(name)))
  }
  return { tokens, structure: structure.replace(/\s+/g, ' ') }
}

const colourFunction = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/
const length = /^-?(?:\d+|\d*\.\d+)(?:px|em|rem)?$/

/** A token value as CSS text, with token references as `var()`; undefined when it is not a plain string. */
function css(value) {
  const reference = /^\w+\[\s*(['"])(--[\w-]+)\1\s*\]$/
  if (reference.test(value)) return `var(${reference.exec(value)[2]})`
  if (/^(['"])[^'"`]*\1$/.test(value)) return value.slice(1, -1)
  if (!/^`[^`]*`$/.test(value)) return undefined
  let complete = true
  const text = value.slice(1, -1).replace(/\$\{([^}]*)\}/g, (_, inner) => {
    const target = reference.exec(inner.trim())
    if (!target) complete = false
    return target ? `var(${target[2]})` : ''
  })
  return complete ? text : undefined
}

/**
 * Tokens whose every value, in every theme, is a colour or a box shadow.
 * Such a value is valid only in properties that paint (a colour, a shadow,
 * a filter), so changing it cannot move a box. Lengths, percentages, numbers,
 * keywords and anything not a plain string count as layout.
 */
function paintTokens(tokens) {
  const paint = new Map()
  const isPaint = name => {
    if (!paint.has(name)) {
      paint.set(name, false)
      paint.set(name, tokens.get(name).values.every(([, value]) => paintValue(css(value)?.trim().toLowerCase())))
    }
    return paint.get(name)
  }
  const colour = text => {
    if (/^#[0-9a-f]{3,8}$/.test(text) || text === 'transparent' || text === 'currentcolor') return true
    const variable = /^var\((--[\w-]+)\)$/.exec(text)
    if (variable) return tokens.has(variable[1]) && isPaint(variable[1])
    return colourFunction.test(text) && matching(text, text.indexOf('(')) === text.length - 1
  }
  const shadow = text => split(text, ',').every(part => {
    const words = split(part.trim(), ' ').filter(word => word !== '' && word !== 'inset')
    const lengths = words.filter(word => length.test(word)).length
    // Two to four lengths and one colour. A border or outline takes one length, so this is a shadow only.
    return lengths >= 2 && lengths <= 4 && words.length === lengths + 1 && words.some(colour)
  })
  const paintValue = text => text !== undefined && text !== '' && (colour(text) || shadow(text))
  for (const name of tokens.keys()) isPaint(name)
  return new Set([...paint].filter(([, value]) => value).map(([name]) => name))
}

/** Properties that only paint. Cursor and user-select stay: the shift walk checks the cursor rule. */
const paintProperties = [
  'color', 'background', 'background-(?:color|image|position(?:-x|-y)?|repeat|clip|origin|attachment|size|blend-mode)',
  'border(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?-color', 'outline-color',
  'box-shadow', 'text-shadow', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'caret-color', 'accent-color',
  'text-decoration-color', 'text-emphasis-color', 'column-rule-color', 'opacity', 'filter', 'backdrop-filter',
  'mix-blend-mode', '-webkit-tap-highlight-color',
]
const paintDeclaration = new RegExp(`(?<=[{;]\\s*)(?:${paintProperties.join('|')})\\s*:[^;{}]*;?`, 'gi')

/** A stylesheet as far as boxes go: without comments and declarations that only paint. */
export function layoutCss(text) {
  let css = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(paintDeclaration, '')
  // A rule left empty styles nothing, whatever it selects.
  for (let before; before !== css;) { before = css; css = css.replace(/[^{};]*\{\s*\}/g, '') }
  return css.replace(/\s+/g, ' ')
}

const staticImport = /import\s+(type\s+)?([\w*{}\s,$]*?)\s*from\s*['"]([^'"]+)['"]/g

/**
 * The tokens a source file reads: names written out (`spacing['--space-2']`,
 * `var(--space-2)`), name prefixes built at run time (`var(--art-${hue})`
 * reads every `--art-` token) and whole groups used other than by a written
 * name (`text[role]`). Unclear use reads every token.
 */
function tokenReads(text, resolve, tokens) {
  const names = new Set()
  const prefixes = new Set()
  const groups = new Set()
  for (const match of text.matchAll(/--[\w-]*/g)) {
    if (text.startsWith('${', match.index + match[0].length)) prefixes.add(match[0])
    else if (tokens.has(match[0])) names.add(match[0])
  }
  let blanked = text
  const locals = new Map()
  for (const match of text.matchAll(staticImport)) {
    const target = resolve(match[3])
    if (!tokenFiles.includes(target)) continue
    blanked = blanked.replace(match[0], ' '.repeat(match[0].length))
    // Theme objects carry overrides, which every read token's key already holds.
    if (match[1] || target !== tokenFiles[0]) continue
    if (!/^\{[^}]*\}$/.test(match[2].trim())) return { all: true }
    for (const binding of match[2].trim().slice(1, -1).split(',')) {
      const [imported, local = imported] = binding.trim().replace(/^type\s+/, '').split(/\s+as\s+/)
      if (imported && !binding.trim().startsWith('type ')) locals.set(local, imported)
    }
  }
  if (/(?:import\(|require\(|export\s[^;]*from)\s*['"][^'"]*tokens\.stylex/.test(blanked)) return { all: true }
  if (locals.size > 0) for (const group of groupReads(text, locals)) groups.add(group)
  return { names, prefixes, groups }
}

/**
 * The groups a file uses other than through a written `group['--name']`:
 * indexed by a variable, passed on whole, spread. Imports, object keys,
 * property names and types are not reads.
 */
function groupReads(text, locals) {
  const groups = new Set()
  const visit = node => {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return
    if (ts.isIdentifier(node) && locals.has(node.text)) {
      const parent = node.parent
      const named = (ts.isPropertyAssignment(parent) || ts.isPropertyAccessExpression(parent) || ts.isJsxAttribute(parent)
        || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node
        || ts.isBindingElement(parent) && parent.propertyName === node
      const written = ts.isElementAccessExpression(parent) && parent.expression === node
        && ts.isStringLiteralLike(parent.argumentExpression) && parent.argumentExpression.text.startsWith('--')
      if (!named && !written) groups.add(locals.get(node.text))
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
  return groups
}
