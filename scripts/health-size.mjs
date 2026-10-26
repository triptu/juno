import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// TypeScript 7 has no JS parser API yet; the size report keeps 5.9 for ts.createSourceFile.
import ts from 'typescript-5'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fileLimit = 400
const functionLimit = 80
const bySize = (a, b) => b.lines - a.lines || a.file.localeCompare(b.file)

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return `${callName(expression.expression)}.${expression.name.text}`
  if (ts.isCallExpression(expression)) return `${callName(expression.expression)}()`
  return '<call>'
}

// The callback of a labelled test call (`test('…', …)`, `syncedTest('…', …)`), optionally limited to the given names.
function isTestCallback(node, names) {
  const call = node.parent
  if (call === undefined || !ts.isCallExpression(call) || !ts.isFunctionLike(node)) return false
  const name = callName(call.expression)
  if (names) return names.includes(name)
  return ts.isStringLiteralLike(call.arguments[0]) && !/(^|\.)(step|describe|extend|use)$/.test(name) && !name.startsWith('test.describe')
}

const hasStep = (node, name = 'test.step') => ts.isCallExpression(node) && callName(node.expression).endsWith(name) || (ts.forEachChild(node, (child) => hasStep(child, name)) ?? false)

// Names and call labels survive line moves. Occurrences distinguish equal callbacks.
function functionContext(node, source) {
  const parts = []
  for (let current = node; current && !ts.isSourceFile(current); current = current.parent) {
    if (current.name) parts.unshift(current.name.getText(source))
    else if (ts.isCallExpression(current)) {
      const label = current.arguments.find((arg) => ts.isStringLiteralLike(arg))
      parts.unshift(callName(current.expression) + (label ? `(${label.getText(source)})` : ''))
    }
  }
  return parts.join('/') || '<callback>'
}

export function collectSizeReport(directory = root) {
  // Git excludes builds, dependencies and other worktrees, and includes new source files.
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
    '--', 'apps', 'packages', 'scripts', 'specs', 'knip.config.mjs'], { cwd: directory, encoding: 'utf8' })
    .split('\0').filter((file) => /\.(?:[cm]?[jt]sx?|css)$/.test(file) && existsSync(resolve(directory, file)))
  const oversizedFiles = []
  const oversizedFunctions = []
  for (const file of new Set(files)) {
    const text = readFileSync(resolve(directory, file), 'utf8')
    const lines = text ? text.split('\n').length - Number(text.endsWith('\n')) : 0
    if (lines > fileLimit) oversizedFiles.push({ file, lines })
    if (file.endsWith('.css') || file.endsWith('.d.ts')) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const occurrences = new Map()
    const visit = (node) => {
      // A flow test (`*.flow.test.ts`) is one user journey on one engine boot; its steps are named with `step`, so the test's own callback may run long.
      // So is a desktop e2e test whose callback names its steps with `test.step`, or a DOM lane test whose callback names
      // them with its `step`: one launch per journey.
      const journey = file.endsWith('.flow.test.ts') ? isTestCallback(node, ['it', 'test'])
        : file.startsWith('apps/desktop/e2e/') && file.endsWith('.spec.ts') ? isTestCallback(node) && hasStep(node)
        : file.startsWith('apps/desktop/dom/') && file.endsWith('.test.ts') && isTestCallback(node, ['domTest']) && hasStep(node, 'step')
      if (ts.isFunctionLike(node) && node.body && !journey) {
        const context = functionContext(node, source)
        const occurrence = (occurrences.get(context) ?? 0) + 1
        occurrences.set(context, occurrence)
        const id = `${context}#${occurrence}`
        const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const end = source.getLineAndCharacterOfPosition(node.end).line + 1
        if (end - start + 1 > functionLimit) {
          const name = node.name ?? node.parent.name
          oversizedFunctions.push({ file, id, name: name?.getText(source) ?? '<callback>', line: start, lines: end - start + 1 })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { fileLimit, functionLimit, scannedFiles: new Set(files).size,
    oversizedFiles: oversizedFiles.toSorted(bySize), oversizedFunctions: oversizedFunctions.toSorted(bySize) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = collectSizeReport()
    console.log(`Size (report only): ${report.oversizedFiles.length} files over ${fileLimit} lines, ${report.oversizedFunctions.length} functions over ${functionLimit} lines`)
    for (const item of report.oversizedFiles) console.log(`  ${item.file}: ${item.lines} lines`)
    for (const item of report.oversizedFunctions) console.log(`  ${item.file}:${item.line} ${item.name}: ${item.lines} lines`)
  } catch (error) {
    console.error(`Size report unavailable: ${error.message}`)
  }
}
