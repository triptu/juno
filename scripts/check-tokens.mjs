#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-5'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['packages/ui', 'packages/views', 'apps/desktop/src/renderer']
const skip = new Set(['node_modules', 'dist', 'out', 'test-results', 'playwright-report'])
const colors = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(' '))
const lengthProperty = /^(?:(?:min|max)?(?:Width|Height|InlineSize|BlockSize)|width|height|inlineSize|blockSize|(?:margin|padding|inset|gap|rowGap|columnGap|top|left|right|bottom|fontSize|letterSpacing|wordSpacing|textIndent|flexBasis|backgroundSize|backgroundPosition|textUnderlineOffset|perspective|scrollMargin|scrollPadding).*|border.*(?:Width|Radius)|outline(?:Width|Offset))$/
const hairline = /^(?:border.*Width|outlineWidth)$/

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* files(file)
    else if (/\.[cm]?[jt]sx?$/.test(file)) yield file
  }
}

function rawString(value, property) {
  // Variable names and URLs are not colour names or literal lengths.
  const css = value.replace(/url\([^)]*\)|--[\w-]+/g, '')
  if (/#(?:[\da-f]{3,8})\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/i.test(css)) return true
  if ((css.match(/[a-z]+/gi) ?? []).some((word) => colors.has(word.toLowerCase()))) return true
  return [...css.matchAll(/(-?(?:\d*\.)?\d+)(px|rem|em)\b/gi)].some(([, n, unit]) =>
    Number(n) !== 0 && !(Number(n) === 1 && unit === 'px' && (hairline.test(property) || /^(?:border(?:Top|Right|Bottom|Left|Block|Inline|BlockStart|BlockEnd|InlineStart|InlineEnd)?|outline)$/.test(property))))
}

export function checkSource(source, file = 'component.tsx') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const namespaces = new Set()
  const creates = new Set()
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@stylexjs/stylex') continue
    const clause = statement.importClause
    if (clause?.name) namespaces.add(clause.name.text)
    const bindings = clause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if ((item.propertyName ?? item.name).text === 'create') creates.add(item.name.text)
    }
  }
  const hits = []
  function report(node, property) {
    const start = node.getStart(tree)
    const line = tree.getLineAndCharacterOfPosition(start).line + 1
    let declaration = node
    while (declaration.parent && !ts.isPropertyAssignment(declaration)) declaration = declaration.parent
    const end = source.indexOf('\n', declaration.end)
    const trailing = source.slice(declaration.end, end < 0 ? source.length : end)
    if (/^[,; \t]*\/\/\s*tokens-allow:\s*\S.*$/.test(trailing)) return
    hits.push({ start, end: node.end, line, property, value: node.getText(tree) })
  }
  function value(node, property) {
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(tree).replace(/^['"]|['"]$/g, '')
      value(node.initializer, key === 'default' || key.startsWith(':') || key.startsWith('@') ? property : key)
      return
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (rawString(node.text, property)) report(node, property)
      return
    }
    if (ts.isNumericLiteral(node) && lengthProperty.test(property)) {
      const number = Number(node.text)
      if (number !== 0 && !(number === 1 && hairline.test(property))) report(node, property)
      return
    }
    // Token member keys are data, not CSS values.
    if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) return
    ts.forEachChild(node, (child) => value(child, property))
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if ((ts.isPropertyAccessExpression(callee) && namespaces.has(callee.expression.getText(tree)) && callee.name.text === 'create') ||
          (ts.isIdentifier(callee) && creates.has(callee.text))) {
        for (const arg of node.arguments) value(arg, '')
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return hits
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let count = 0
  for (const base of roots) for (const file of files(path.join(root, base))) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('@stylexjs/stylex')) continue
    for (const hit of checkSource(source, file)) {
      console.error(`${path.relative(root, file)}:${hit.line}: ${hit.property}: ${hit.value} — use @juno/tokens`)
      count++
    }
  }
  console.log(`check-tokens: ${count ? `${count} violations` : 'ok'}`)
  if (count) process.exitCode = 1
}
