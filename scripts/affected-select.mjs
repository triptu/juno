// Which e2e specs a change reaches (docs/development.md, "Affected tests"):
// desktop specs by the coverage map (scripts/coverage-map.mjs), gallery
// behaviour specs by the components they open. Pure: scripts/affected.mjs
// passes in what it knows from git and the import graph.

/** A map older than this is not used: the import graph decides instead. */
export const MAX_MAP_AGE_DAYS = 3

const SOURCE = /\.(ts|tsx|mts|js|mjs|cjs)$/

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
 */
export function selectSpecs({ specs, changed, map, support, own, app, isNew, drift, importers }) {
  const supportChange = changed.find((file) => support.has(file))
  if (supportChange !== undefined) return { all: `${supportChange} is shared e2e support` }

  const index = new Map(map.specs.map((spec, at) => [spec, at]))
  const ran = (file) => (map.files[file] ?? []).map((at) => map.specs[at])
  const moduleOnly = new Set(map.moduleOnly)
  const picked = new Map()
  const pick = (spec, reason) => {
    if (!specs.includes(spec)) return
    if (!picked.has(spec)) picked.set(spec, [])
    picked.get(spec).push(reason)
  }

  for (const spec of specs) for (const file of changed) if (own(spec).has(file)) pick(spec, file === spec ? 'the spec changed' : `its helper ${file} changed`)

  let appChanged = false
  for (const file of changed) {
    const known = file in map.files || moduleOnly.has(file)
    if (!app.has(file) && !known) continue
    appChanged = true
    if (!SOURCE.test(file)) return { all: `${file} is an app file outside the JavaScript bundles (style sheet, page or asset)` }
    if (moduleOnly.has(file)) return { all: `${file} is in the app, but no spec ran a function from it (module-level code only)` }

    if (file in map.files) for (const spec of ran(file)) pick(spec, `ran ${file}`)
    else if (isNew(file)) {
      // A new file runs only through what imports it: walk up to files the map knows.
      const seen = new Set([file])
      const queue = [file]
      let found = false
      while (queue.length > 0) {
        const current = queue.shift()
        for (const importer of importers(current)) {
          if (seen.has(importer)) continue
          seen.add(importer)
          if (moduleOnly.has(importer)) return { all: `${file} is new and ${importer}, which imports it, has module-level code only` }
          if (importer in map.files) {
            found = true
            for (const spec of ran(importer)) pick(spec, `${file} is new; ${importer} imports it and ran here`)
          } else if (isNew(importer) || app.has(importer)) queue.push(importer)
        }
      }
      if (!found) return { all: `${file} is new and nothing that imports it has coverage` }
    }
    // Otherwise the file was in no bundle when the map was recorded: types only, or not used by the app.

    // The map is older than the change: an importer edited since may call into this file now.
    // (A new file's importers were walked above.)
    if (!isNew(file)) for (const importer of importers(file)) {
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
