// Quint's RPC serialization keeps analysis metadata from every imported module.
// For memory this exceeds Apalache's 20 MB string limit. Keep exactly the types,
// effects and lookup entries whose IDs occur in the compiled main module. The
// module and all of its expressions remain unchanged. check.mjs runs this in a
// timed child just like the CLI; this adapter uses the pinned Quint 0.33.0 pipeline.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkg = require.resolve('@informalsystems/quint/package.json')
const commands = require(join(dirname(pkg), 'dist/src/cliCommands.js'))
const { parseServerEndpoint } = require(join(dirname(pkg), 'dist/src/apalache.js'))
const args = JSON.parse(process.argv[2])
args.serverEndpoint = parseServerEndpoint(`localhost:${args.port}`).value
let result = await commands.load(args)
for (const command of ['parse', 'typecheck', 'compile']) {
  if (result.isLeft()) break
  result = await commands[command](result.value)
}
if (!result.isLeft()) {
  const compiled = result.value
  const ids = new Set()
  function collect(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.id === 'bigint') ids.add(value.id)
    for (const child of Object.values(value)) collect(child)
  }
  collect(compiled.mainModule)
  const keep = entries => new Map([...entries].filter(([id]) => ids.has(id)))
  const reduced = { ...compiled, types: keep(compiled.types), effects: keep(compiled.effects), table: keep(compiled.table) }
  console.log(`Agent checker metadata: ${reduced.types.size}/${compiled.types.size} live type entries`)
  result = await commands.verifySpec(reduced)
}
if (result.isLeft()) {
  console.error(result.value.msg)
  for (const error of result.value.stage?.errors ?? []) console.error(error.message ?? error)
}
process.exit(result.isLeft() ? 1 : 0)
