// Which e2e specs a change reaches (docs/development.md, "Affected tests"):
// desktop specs by the coverage map (scripts/coverage-map.mjs), gallery
// behaviour specs by the components they open. Pure: scripts/affected.mjs
// passes in what it knows from git and the import graph.

/** A map older than this is not used: the import graph decides instead. */
export const MAX_MAP_AGE_DAYS = 3

const SOURCE = /\.(ts|tsx|mts|js|mjs|cjs)$/
const DRIVER = /^apps\/desktop\/e2e\/driver\//

/** At most this many desktop specs come from coverage in a narrow plan; changed and named specs come on top. */
export const MAX_COVERAGE_SPECS = 10

/**
 * Returns `{ all }` with a reason when every spec must run, or `{ specs }`, a
 * Map from each picked spec to the reasons it was picked, with `scores` (how
 * directly each spec covers the change; see `rankSpecs`), `required` (changed
 * specs and those whose own helper changed) and `notes` (what a narrow
 * selection left to the scheduled full run).
 *
 * - `specs`: every desktop e2e spec file.
 * - `changed`: the change, as repo paths.
 * - `map`: the coverage map.
 * - `support`: files every spec depends on (fixtures, driver, configs, the fake Slack).
 * - `own(spec)`: the spec file and its own helpers, outside the app and the shared support.
 * - `app`: every file the app reaches by the import graph.
 * - `isNew(file)`: the file did not exist at the map's commit.
 * - `drift`: files changed since the map's commit, this change included.
 * - `importers(file)`: the files that import `file` directly.
 * - `driver(files)`: for changed driver files, the specs they reach with a
 *   reason (`driverSpecs`), or undefined when every spec may be reached.
 * - `narrow`: never return `{ all }`. Changed support (the fake Slack, the
 *   fixtures, the driver) picks the specs that use what changed, through
 *   `reach(files)` (`reachSpecs`, with each spec's depth); where no spec can be
 *   told apart, every spec is a candidate with no score. A style sheet, or a
 *   file nothing that ran imports, picks nothing and adds a note.
 */
export function selectSpecs({ specs, changed, map, support, own, app, isNew, drift, importers, driver = () => undefined, narrow = false, reach = () => undefined }) {
  const { picked, scores, pick, strongestFirst } = picks(specs)
  const required = new Set()
  const notes = []
  const index = new Map(map.specs.map((spec, at) => [spec, at]))
  const ran = (file) => (map.files[file] ?? []).map((at) => map.specs[at])
  // A file every spec runs (app boot, the shared harness) says nothing about a spec; one few specs run says a lot.
  const total = Math.max(map.specs.length, 1)
  const weightOf = (file) => Math.log(total / Math.max(ran(file).length, 1))
  const ranBy = (file) => (narrow ? ` (run by ${ran(file).length} of ${total} specs)` : '')
  const direct = Math.log(total)
  const everySpec = (reason) => {
    for (const spec of specs) pick(spec, reason)
    notes.push(`${reason}: no spec can be told apart, so the smallest specs stand in for all of them`)
  }

  const supportAll = pickSupport({ changed: changed.filter((file) => support.has(file)), narrow, reach, driver, pick, everySpec, direct })
  if (supportAll !== undefined) return { all: supportAll }

  const moduleOnly = new Set(map.moduleOnly)
  const throughImporters = (file) => importersThatRan(file, { importers, ran, ranFiles: map.files, walk: (importer) => moduleOnly.has(importer) || isNew(importer) || app.has(importer) })

  // A changed spec always runs. A changed helper picks the specs that import it, ranked above
  // coverage picks: one shared by a few specs counts more than one most specs import.
  for (const file of changed) {
    const users = specs.filter((spec) => own(spec).has(file))
    for (const spec of users) {
      if (file === spec) required.add(spec)
      pick(spec, file === spec ? 'the spec changed' : `its helper ${file} changed`, file === spec ? 0 : 1 + Math.log(total / users.length))
    }
  }

  let appChanged = false
  for (const file of changed) {
    const known = file in map.files || moduleOnly.has(file)
    if (!app.has(file) && !known) continue
    appChanged = true
    if (!SOURCE.test(file)) {
      const reason = `${file} is an app file outside the JavaScript bundles (style sheet, page or asset)`
      if (!narrow) return { all: reason }
      notes.push(`${reason}: no spec picked for it; the gallery and the scheduled full run check it`)
      continue
    }
    if (file in map.files) for (const spec of ran(file)) pick(spec, `ran ${file}${ranBy(file)}`, weightOf(file))
    else if (moduleOnly.has(file) || isNew(file)) {
      // Module-level code, or a new file, runs only through what imports it: walk up to files that ran.
      const why = moduleOnly.has(file) ? 'has module-level code only' : 'is new'
      const reached = throughImporters(file)
      if (reached.size === 0) {
        const reason = `${file} ${why} and nothing that imports it ran in a spec`
        if (!narrow) return { all: reason }
        notes.push(`${reason}: no spec picked for it`)
        continue
      }
      for (const [importer, specsOf] of reached) for (const spec of specsOf) pick(spec, `${file} ${why}; ${importer} imports it and ran here`, weightOf(importer))
    }
    // Otherwise the file was in no bundle when the map was recorded: types only, or not used by the app.

    // The map is older than the change: an importer edited since may call into this file now.
    // (The importers of a new or module-level file were walked above.)
    if (file in map.files) for (const importer of importers(file)) {
      if (!drift.has(importer) || !(importer in map.files)) continue
      for (const spec of ran(importer)) pick(spec, `${importer} imports ${file} and changed since the map`, weightOf(importer) / 2)
    }
  }

  // A spec the map has no coverage for runs whenever the app changed.
  if (appChanged) for (const spec of specs) if (!index.has(spec)) pick(spec, 'no coverage recorded for it')

  // A spec named like a changed file (palette.spec.ts for Palette.tsx) likely tests it directly.
  if (narrow)
    for (const spec of picked.keys()) {
      const like = namedLike(spec, changed)
      if (like !== undefined) pick(spec, `named like ${like.file}`, 0.5 * like.shared)
    }
  // In a narrow selection the plan prints each spec's strongest reason first.
  if (narrow) strongestFirst()
  return { specs: picked, scores, required, notes }
}

/** The picked specs with their reasons, each spec's score (the sum of its reasons' weights), and a way to sort each spec's reasons by weight. */
function picks(specs) {
  const picked = new Map()
  const scores = new Map()
  const weights = new Map()
  const pick = (spec, reason, weight = 0) => {
    if (!specs.includes(spec)) return
    if (!picked.has(spec)) picked.set(spec, [])
    picked.get(spec).push(reason)
    weights.set(`${spec}\0${reason}`, weight)
    scores.set(spec, (scores.get(spec) ?? 0) + weight)
  }
  const strongestFirst = () => {
    for (const [spec, reasons] of picked) reasons.sort((a, b) => weights.get(`${spec}\0${b}`) - weights.get(`${spec}\0${a}`))
  }
  return { picked, scores, pick, strongestFirst }
}

/**
 * Picks for changed shared e2e support. A driver change reaches the specs that
 * use what changed (driverSpecs); any other support change reaches every spec,
 * or in a narrow selection the specs that use the changed exports
 * (reachSpecs), nearer ones weighing more. Returns why every spec runs, or
 * undefined.
 */
function pickSupport({ changed, narrow, reach, driver, pick, everySpec, direct }) {
  if (changed.length === 0) return undefined
  if (narrow) {
    const reached = reach(changed)
    // Nothing placed, or nothing a spec names: every spec may reach it, so a sample stands in.
    if (reached === undefined || reached.size === 0) everySpec(`${changed.join(', ')} is shared e2e support every spec reaches`)
    else for (const [spec, { reason, depth }] of reached) pick(spec, reason, direct / (1 + depth))
    return undefined
  }
  const notDriver = changed.find((file) => !DRIVER.test(file))
  if (notDriver !== undefined) return `${notDriver} is shared e2e support`
  const reached = driver(changed)
  if (reached === undefined) return `${changed.join(', ')} changed outside a named driver member`
  for (const [spec, reason] of reached) pick(spec, reason, direct)
  return undefined
}

/** The files that ran and import `file`, walking up through importers that did not run (`walk`: module-level code only, new, or types). */
function importersThatRan(file, { importers, ran, ranFiles, walk }) {
  const reached = new Map()
  const seen = new Set([file])
  const queue = [file]
  while (queue.length > 0) {
    for (const importer of importers(queue.shift())) {
      if (seen.has(importer)) continue
      seen.add(importer)
      if (importer in ranFiles) reached.set(importer, ran(importer))
      else if (walk(importer)) queue.push(importer)
    }
  }
  return reached
}

/** The first changed file (not a spec) whose name shares a word with the spec's, and how many words they share. */
function namedLike(spec, changed) {
  const own = words(spec.split('/').at(-1))
  for (const file of changed) {
    if (file.endsWith('.spec.ts')) continue
    const shared = words(file.split('/').at(-1)).filter((part) => own.includes(part)).length
    if (shared > 0) return { file, shared }
  }
  return undefined
}

/** The words of a file name: `PaletteContent.tsx` gives palette and content. Short words and file suffixes say nothing. */
function words(name) {
  return name
    .replace(/\.(spec|test|fixtures)?\.?[a-z]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((part) => part.length >= 4)
}

/**
 * The specs a narrow plan runs: every required spec, then at most `max` of the
 * others, the highest score first. A tie goes to the spec that ran fewer files
 * (`size`), which is usually the quicker one, then by path. Returns the kept
 * reasons and the specs left out.
 */
export function rankSpecs({ specs, scores, required, max = MAX_COVERAGE_SPECS, size = () => 0 }) {
  const order = [...specs.keys()].filter((spec) => !required.has(spec)).toSorted((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || size(a) - size(b) || a.localeCompare(b))
  const kept = [...[...required].filter((spec) => specs.has(spec)), ...order.slice(0, max)]
  return { specs: new Map(kept.map((spec) => [spec, specs.get(spec)])), dropped: order.slice(max) }
}

/** Why the map cannot be used, or undefined when it can. */
export function mapProblem(map, { now = Date.now(), commitKnown }) {
  if (map === undefined) return 'there is no coverage map'
  if (map.version !== 1) return `the coverage map has version ${map.version}`
  if (!commitKnown) return `the coverage map's commit ${String(map.commit).slice(0, 10)} is not in this repository`
  const days = (now - Date.parse(map.recordedAt)) / 86_400_000
  if (!(days <= MAX_MAP_AGE_DAYS)) return `the coverage map is ${Number.isFinite(days) ? `${Math.floor(days)} days` : 'of unknown age and'} old (at most ${MAX_MAP_AGE_DAYS})`
  return undefined
}

/**
 * The gallery components a behaviour spec opens: the fixture names it spells
 * out. A spec that reads every route without filtering them, or names none,
 * walks every component (`'*'`).
 */
export function galleryComponents(text, names) {
  if (/=\s*await readRoutes\(page\)\s*$/m.test(text)) return '*'
  // Quoted names ('Sidebar'), and names in gallery addresses (/Sidebar?__state=…, #/Sidebar).
  const named = [...new Set([...text.matchAll(/'([A-Z][A-Za-z]+)'|(?:\/|#\/)([A-Z][A-Za-z]+)(?=\?__state|['`?])/g)].map((match) => match[1] ?? match[2]))].filter((name) => names.has(name))
  return named.length > 0 ? named.toSorted() : '*'
}

const COMMENT_OR_BLANK = /^\s*(\/\/.*|\/\*.*|\*.*|)$/
const TOP_LEVEL = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+(\w+)/
const CLASS_MEMBER = /^ {2}(?:(?:static|readonly|private|protected|public|async|get|set|override|declare)\s+)*\*?(#?\w+)\s*[(<:=?!]/

/**
 * The named parts of a driver file: top-level declarations, and class
 * members at two spaces (with `owner`, their class; a constructor is named
 * after its class). Each has its first and last line (1-based) and owns the
 * comments and blank lines just above it. Import lines belong to no name:
 * they change nothing on their own.
 */
export function driverMembers(text) {
  const lines = text.split('\n')
  const members = []
  let inClass
  for (const [index, line] of lines.entries()) {
    const top = TOP_LEVEL.exec(line)
    const member = inClass !== undefined && CLASS_MEMBER.exec(line)
    if (top) {
      inClass = /\bclass\s/.test(line.split('{')[0]) ? top[1] : undefined
      members.push({ name: top[1], start: index + 1, header: inClass !== undefined })
    } else if (member) members.push(member[1] === 'constructor' ? { name: inClass, start: index + 1 } : { name: member[1], owner: inClass, start: index + 1 })
    else if (/^(import|export\s+\{|export\s+\*)/.test(line)) members.push({ start: index + 1 })
    else if (line.startsWith('}')) inClass = undefined
  }
  // Each part runs to the line before the next one; comments and blank lines above a part are its own.
  for (const [at, member] of members.entries()) {
    const floor = at === 0 ? 1 : members[at - 1].start + 1
    while (member.start > floor && COMMENT_OR_BLANK.test(lines[member.start - 2])) member.start--
  }
  return members.map((member, at) => ({ ...member, header: member.header === true, end: at + 1 < members.length ? members[at + 1].start - 1 : lines.length, key: member.owner ? `${member.owner}.${member.name}` : member.name }))
}

/**
 * The driver parts the changed lines fall in (`Class.member`, or a top-level
 * name), or undefined when one falls outside every part or on a class's own
 * line (then every spec may be reached). Blank changed lines change nothing.
 */
export function changedMembers(text, changedLines) {
  const members = driverMembers(text)
  const lines = text.split('\n')
  const keys = new Set()
  for (const number of changedLines) {
    if (number > lines.length || lines[number - 1].trim() === '') continue
    const member = members.find((candidate) => candidate.start <= number && number <= candidate.end)
    if (member === undefined) return undefined
    if (member.key === undefined) continue
    // A class's own line (what it extends, how it is built) reaches every use of it.
    if (member.header) {
      if (!COMMENT_OR_BLANK.test(lines[number - 1])) return undefined
      continue
    }
    keys.add(member.key)
  }
  return keys
}

const word = (text, name, access) => new RegExp(`${access ? '\\.' : '\\b'}${name.replace(/[$#]/g, '\\$&')}\\b`).test(text)

/**
 * The specs a driver change reaches. A spec reaches `Class.member` when it
 * names the member (`.member`) and can get a `Class`: it names the class, or
 * an accessor that builds or returns one. Driver parts that use a changed
 * part count as changed too, until nothing new is found.
 * `changed`: per changed driver file, its text and changed lines.
 * `driverTexts`: every driver file. `specTexts`: per spec, the text of the
 * spec and its own helpers. Undefined when a change is outside every part.
 */
export function driverSpecs({ changed, driverTexts, specTexts }) {
  const reached = reachSpecs({ changed, corpus: driverTexts, specTexts, exportsWhenOutside: false })
  return reached && new Map([...reached].map(([spec, { reason }]) => [spec, reason]))
}

const EXPORTED = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+(\w+)/gm

/**
 * As `driverSpecs`, for any shared e2e support (the driver, the fixtures, the
 * fake Slack, the fake OpenRouter), with each spec's depth: 0 when the spec
 * names what changed, one more for each part in between. `corpus`: the texts
 * of every support file, through which a change spreads. With
 * `exportsWhenOutside`, a change outside every part counts as a change to each
 * name the file exports. A Slack method a changed line names
 * (`'conversations.history'`) reaches, at depth 0, the specs that name it.
 * Undefined when nothing can be placed.
 */
export function reachSpecs({ changed, corpus, specTexts, exportsWhenOutside = true }) {
  const depths = new Map()
  const methods = new Set()
  for (const { text, lines } of changed) {
    let found = changedMembers(text, lines)
    if (found === undefined) {
      if (!exportsWhenOutside) return undefined
      found = new Set([...text.matchAll(EXPORTED)].map((match) => match[1]))
    }
    for (const key of found) depths.set(key, 0)
    const all = text.split('\n')
    for (const number of lines) for (const match of (all[number - 1] ?? '').matchAll(/['"`]([a-z]+(?:\.[a-zA-Z]+)+)['"`]/g)) methods.add(match[1])
  }
  if (depths.size === 0 && methods.size === 0) return exportsWhenOutside ? undefined : new Map()
  const parts = corpus.flatMap((text) => {
    const lines = text.split('\n')
    return driverMembers(text).filter((member) => member.key !== undefined && !member.header).map((member) => ({ ...member, body: lines.slice(member.start - 1, member.end).join('\n') }))
  })
  const accessors = new Map()
  const accessorsOf = (owner) => {
    if (!accessors.has(owner)) accessors.set(owner, parts.filter((part) => part.name !== owner && new RegExp(`\\bnew ${owner}\\(|:\\s*${owner}\\b|<${owner}>`).test(part.body)).map((part) => part))
    return accessors.get(owner)
  }
  const uses = (text, key, from) => {
    const [owner, name] = key.includes('.') ? key.split('.') : [undefined, key]
    if (owner === undefined) return word(text, name, false)
    return word(text, name, true) && (from === owner || word(text, owner, false) || accessorsOf(owner).some((accessor) => word(text, accessor.name, accessor.owner !== undefined)))
  }
  for (let depth = 1, grew = true; grew; depth++) {
    grew = false
    const known = [...depths.keys()]
    for (const part of parts) {
      // A constructor is named after its class and has no owner: it is inside the class all the same.
      if (depths.has(part.key) || !known.some((key) => uses(part.body, key, part.owner ?? part.name))) continue
      depths.set(part.key, depth)
      grew = true
    }
  }
  const picked = new Map()
  for (const [spec, text] of specTexts) {
    const method = [...methods].find((name) => text.includes(name))
    if (method !== undefined) {
      picked.set(spec, { reason: `it uses the fake Slack's ${method}, which changed`, depth: 0 })
      continue
    }
    const used = [...depths].filter(([key]) => uses(text, key)).toSorted((a, b) => a[1] - b[1])[0]
    if (used !== undefined) picked.set(spec, { reason: `it uses ${used[0]}, which changed or uses what changed`, depth: used[1] })
  }
  return picked
}
