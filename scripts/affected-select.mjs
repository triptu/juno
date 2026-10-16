// Which e2e specs a change reaches (docs/development.md, "Affected tests"):
// desktop specs by the coverage map (scripts/coverage-map.mjs), gallery
// behaviour specs by the components they open. Pure: scripts/affected.mjs
// passes in what it knows from git and the import graph.

/** A map older than this is not used: the import graph decides instead. */
export const MAX_MAP_AGE_DAYS = 3

const SOURCE = /\.(ts|tsx|mts|js|mjs|cjs)$/
const DRIVER = /^apps\/desktop\/e2e\/driver\//

/**
 * Returns `{ all }` with a reason when every spec must run, or `{ specs }`, a
 * Map from each picked spec to the reasons it was picked.
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
 */
export function selectSpecs({ specs, changed, map, support, own, app, isNew, drift, importers, driver = () => undefined }) {
  const picked = new Map()
  const pick = (spec, reason) => {
    if (!specs.includes(spec)) return
    if (!picked.has(spec)) picked.set(spec, [])
    picked.get(spec).push(reason)
  }

  // A driver change reaches the specs that use what changed (driverSpecs); any other support change reaches every spec.
  const supportChanges = changed.filter((file) => support.has(file))
  const notDriver = supportChanges.find((file) => !DRIVER.test(file))
  if (notDriver !== undefined) return { all: `${notDriver} is shared e2e support` }
  if (supportChanges.length > 0) {
    const reached = driver(supportChanges)
    if (reached === undefined) return { all: `${supportChanges.join(', ')} changed outside a named driver member` }
    for (const [spec, reason] of reached) pick(spec, reason)
  }

  const index = new Map(map.specs.map((spec, at) => [spec, at]))
  const ran = (file) => (map.files[file] ?? []).map((at) => map.specs[at])
  const moduleOnly = new Set(map.moduleOnly)

  /** The files that ran and import `file`, walking up through importers that did not run (module-level code only, new, or types). */
  const throughImporters = (file) => {
    const reached = new Map()
    const seen = new Set([file])
    const queue = [file]
    while (queue.length > 0) {
      for (const importer of importers(queue.shift())) {
        if (seen.has(importer)) continue
        seen.add(importer)
        if (importer in map.files) reached.set(importer, ran(importer))
        else if (moduleOnly.has(importer) || isNew(importer) || app.has(importer)) queue.push(importer)
      }
    }
    return reached
  }

  for (const spec of specs) for (const file of changed) if (own(spec).has(file)) pick(spec, file === spec ? 'the spec changed' : `its helper ${file} changed`)

  let appChanged = false
  for (const file of changed) {
    const known = file in map.files || moduleOnly.has(file)
    if (!app.has(file) && !known) continue
    appChanged = true
    if (!SOURCE.test(file)) return { all: `${file} is an app file outside the JavaScript bundles (style sheet, page or asset)` }
    if (file in map.files) for (const spec of ran(file)) pick(spec, `ran ${file}`)
    else if (moduleOnly.has(file) || isNew(file)) {
      // Module-level code, or a new file, runs only through what imports it: walk up to files that ran.
      const why = moduleOnly.has(file) ? 'has module-level code only' : 'is new'
      const reached = throughImporters(file)
      if (reached.size === 0) return { all: `${file} ${why} and nothing that imports it ran in a spec` }
      for (const [importer, specsOf] of reached) for (const spec of specsOf) pick(spec, `${file} ${why}; ${importer} imports it and ran here`)
    }
    // Otherwise the file was in no bundle when the map was recorded: types only, or not used by the app.

    // The map is older than the change: an importer edited since may call into this file now.
    // (The importers of a new or module-level file were walked above.)
    if (file in map.files) for (const importer of importers(file)) {
      if (!drift.has(importer) || !(importer in map.files)) continue
      for (const spec of ran(importer)) pick(spec, `${importer} imports ${file} and changed since the map`)
    }
  }

  // A spec the map has no coverage for runs whenever the app changed.
  if (appChanged) for (const spec of specs) if (!index.has(spec)) pick(spec, 'no coverage recorded for it')
  return { specs: picked }
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
  const keys = new Set()
  for (const { text, lines } of changed) {
    const found = changedMembers(text, lines)
    if (found === undefined) return undefined
    for (const key of found) keys.add(key)
  }
  const parts = driverTexts.flatMap((text) => {
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
  for (let grew = true; grew; ) {
    grew = false
    for (const part of parts) {
      if (keys.has(part.key) || ![...keys].some((key) => uses(part.body, key, part.owner))) continue
      keys.add(part.key)
      grew = true
    }
  }
  const picked = new Map()
  for (const [spec, text] of specTexts) {
    const used = [...keys].find((key) => uses(text, key))
    if (used !== undefined) picked.set(spec, `it uses the driver's ${used}, which changed or uses what changed`)
  }
  return picked
}
