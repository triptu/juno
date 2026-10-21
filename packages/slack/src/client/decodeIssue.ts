/** Schema diagnostics contain only schema-owned field names, indexes and fixed issue kinds. */
import { Methods, ThreadView } from '@juno/slack-schema'
import { SchemaAST, type SchemaIssue } from 'effect'

const fields = new Set(['unknown'])
const visited = new Set<SchemaAST.AST>()
function collect(ast: SchemaAST.AST): void {
  if (visited.has(ast)) return
  visited.add(ast)
  switch (ast._tag) {
    case 'Objects':
      for (const property of ast.propertySignatures) {
        if (typeof property.name === 'string' && /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(property.name)) fields.add(property.name)
        collect(property.type)
      }
      for (const signature of ast.indexSignatures) collect(signature.type)
      break
    case 'Arrays':
      for (const child of [...ast.elements, ...ast.rest]) collect(child)
      break
    case 'Union':
      for (const child of ast.types) collect(child)
      break
    case 'Suspend': collect(ast.thunk()); break
    case 'Declaration':
      for (const child of ast.typeParameters) collect(child)
      break
  }
}
for (const method of Object.values(Methods)) collect(method.response.ast)
collect(ThreadView.ast)

/** A syntactically valid identifier alone is insufficient: record keys can contain private data. */
export function isSchemaPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 300 && /^(?:[a-zA-Z_][a-zA-Z_0-9]*|\[\d{1,9}\])(?:\.[a-zA-Z_][a-zA-Z_0-9]*|\[\d{1,9}\])*$/.test(path) &&
    path.split(/\.|\[\d+\]/).filter(Boolean).every((field) => fields.has(field))
}

export function decodeIssueDetails(issue: SchemaIssue.Issue, prefix: ReadonlyArray<PropertyKey> = []): { schemaPath: string; issueKind: 'missing' | 'wrong_type' | 'invalid' } {
  switch (issue._tag) {
    case 'Pointer': return decodeIssueDetails(issue.issue, [...prefix, ...issue.path])
    case 'Composite':
    case 'AnyOf':
      if (issue.issues[0] !== undefined) return decodeIssueDetails(issue.issues[0], prefix)
      break
    case 'Filter':
    case 'Encoding': return decodeIssueDetails(issue.issue, prefix)
  }
  const path = prefix.map((part) => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 && part <= 999_999_999
    ? `[${part}]`
    : `${fields.has(String(part)) ? String(part) : 'unknown'}`).reduce((path, part) => path === '' || part.startsWith('[') ? path + part : `${path}.${part}`, '')
  return {
    schemaPath: isSchemaPath(path) ? path : 'unknown',
    issueKind: issue._tag === 'MissingKey' ? 'missing' : issue._tag === 'InvalidType' ? 'wrong_type' : 'invalid',
  }
}
