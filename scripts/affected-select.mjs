// Which e2e specs a change reaches (docs/development.md, "Affected tests"):
// desktop specs by the shared e2e support they use, gallery behaviour specs
// by the components they open, gallery components within a time budget.
// Pure: scripts/affected.mjs passes in what it knows from git and the import
// graph.

/** Estimated test seconds for optional gallery components; required ones always run. */
export const GALLERY_BUDGET_SECONDS = 300

/**
 * The items a plan runs: every required item, then optional candidates
 * within the test-seconds budget, the highest score first. A tie goes to the smaller item
 * (`size`), which is usually the quicker one, then by path. Returns the kept
 * reasons and the specs left out.
 */
export function rankSpecs({ specs, scores, required, budget = GALLERY_BUDGET_SECONDS, seconds = () => 60, size = () => 0 }) {
  if (!(budget >= 0)) throw new Error('The time budget must be non-negative')
  const order = [...specs.keys()].filter((spec) => !required.has(spec)).toSorted((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || size(a) - size(b) || a.localeCompare(b))
  const kept = [...required].filter((spec) => specs.has(spec))
  const dropped = []
  let estimatedSeconds = 0
  for (const spec of order) {
    const cost = seconds(spec)
    if (estimatedSeconds + cost <= budget) { kept.push(spec); estimatedSeconds += cost }
    else dropped.push(spec)
  }
  return { specs: new Map(kept.map((spec) => [spec, specs.get(spec)])), dropped, estimatedSeconds }
}

export function rankComponents({ components, all, changed, budget, seconds = 30 }) {
  const names = new Set(changed.map((file) => file.split('/').at(-1).replace(/(\.fixtures)?\.[a-z]+$/, '')))
  const required = new Set(components.filter((item) => names.has(item.id)).map((item) => item.id))
  const scores = new Map(components.map((item) => [item.id, changed.filter((file) => item.inputs.has(file))
    .reduce((sum, file) => sum + Math.log(all.length / Math.max(1, all.filter((candidate) => candidate.inputs.has(file)).length)), 0)]))
  const ranked = rankSpecs({ specs: new Map(components.map((item) => [item.id, []])), scores, required, budget, seconds: () => seconds, size: (id) => components.find((item) => item.id === id).inputs.size })
  return { items: components.filter((item) => ranked.specs.has(item.id)), dropped: ranked.dropped }
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

const EXPORTED = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+(\w+)/gm

/**
 * The specs a change to shared e2e support reaches (the driver, the fixtures, the
 * fake Slack, the fake OpenRouter), with each spec's depth: 0 when the spec
 * names what changed, one more for each part in between. `corpus`: the texts
 * of every support file, through which a change spreads. A change outside
 * every part counts as a change to each name the file exports. A Slack method a changed line names
 * (`'conversations.history'`) reaches, at depth 0, the specs that name it.
 * Undefined when nothing can be placed.
 */
export function reachSpecs({ changed, corpus, specTexts }) {
  const depths = new Map()
  const methods = new Set()
  for (const { text, lines } of changed) {
    const found = changedMembers(text, lines) ?? new Set([...text.matchAll(EXPORTED)].map((match) => match[1]))
    for (const key of found) depths.set(key, 0)
    const all = text.split('\n')
    for (const number of lines) for (const match of (all[number - 1] ?? '').matchAll(/['"`]([a-z]+(?:\.[a-zA-Z]+)+)['"`]/g)) methods.add(match[1])
  }
  if (depths.size === 0 && methods.size === 0) return undefined
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
