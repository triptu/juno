// Worker counts for a run under a memory budget: JUNO_MEMORY_BUDGET=4g (docs/development.md, "Memory").
// Each lane's memory is a fixed part (its runner, servers and one-off processes) plus a part per worker,
// measured per process on the laptop with the heap caps below on. A lane gets as many workers as fit
// the budget, at most what its threads keep busy. Explicit worker settings win (scripts/remote/workers.sh,
// scripts/verify-execution.mjs).
import { availableParallelism } from 'node:os'

// Megabytes of proportional memory (PSS) per lane, from scripts/memory-report.mjs on the laptop (10-26), with
// some room over the measured peaks. A build before a lane (vite, electron-vite) peaks near 1.3 GB alone.
export const laneMemory = {
  // A bun test worker (450-560 MB).
  unit: { fixed: 150, worker: 450 },
  // A bun test worker that holds the renderer's context (to about 450 MB, apps/desktop/dom/test.ts), and its engine host (220).
  dom: { fixed: 200, worker: 650 },
  // A Playwright worker (250), its engine host (220), the page's renderer (300, up to 600 on the large seeds) and
  // Chromium's browser, GPU and utility processes (110); the runner (360) is fixed.
  browser: { fixed: 450, worker: 700 },
  // A Playwright worker and the app: main (260), renderer (200), engine and agent (200), GPU (70).
  electron: { fixed: 350, worker: 900 },
  // A Playwright worker (230), Chromium and the gallery page (330, growing over the run); the runner and the
  // preview server are fixed.
  gallery: { fixed: 400, worker: 650 },
}

/** `4g`, `4096m` or `4096` (megabytes) in megabytes. */
export function parseBudget(text) {
  const match = /^(\d+(?:\.\d+)?)([gm]?)$/i.exec(String(text).trim())
  if (!match) throw new Error(`JUNO_MEMORY_BUDGET takes a size such as 4g or 4096m, not ${text}`)
  return Math.floor(Number(match[1]) * (match[2].toLowerCase() === 'g' ? 1024 : 1))
}

const fit = (lane, budget, most) => Math.max(1, Math.min(most, Math.floor((budget - laneMemory[lane].fixed) / laneMemory[lane].worker)))

/**
 * The environment for a serial run (each step alone) within `budget` megabytes on `threads` threads:
 * worker counts per lane and the Apalache heap.
 */
export function budgetEnv(budget, threads) {
  const workers = {
    unit: fit('unit', budget, threads),
    dom: fit('dom', budget, threads),
    browser: fit('browser', budget, Math.max(1, Math.round(threads * 5 / 8))),
    electron: fit('electron', budget, Math.max(1, Math.floor(threads / 2))),
    gallery: fit('gallery', budget, Math.max(1, Math.round(threads * 4 / 3))),
  }
  return {
    JUNO_TEST_WORKERS: String(workers.unit),
    JUNO_DOM_WORKERS: String(workers.dom),
    JUNO_BROWSER_WORKERS: String(workers.browser),
    JUNO_E2E_WORKERS: String(workers.electron),
    GALLERY_WORKERS: String(workers.gallery),
    GALLERY_SHIFT_PARTS: String(workers.gallery),
    GALLERY_CACHED_WORKERS: String(Math.max(1, Math.floor(workers.gallery / 2))),
    // One Apalache JVM, its heap from what the budget leaves after Quint's Node processes.
    SPECS_JOBS: String(Math.max(1, Math.min(2, Math.floor(threads / 2)))),
    SPECS_APALACHE: '1',
    SPECS_APALACHE_HEAP: `${Math.max(512, Math.min(1536, budget - 1024))}m`,
    CONFORMANCE_JOBS: String(Math.max(1, Math.min(4, Math.floor(budget / 1024), threads))),
  }
}

// `bun scripts/memory-budget.mjs 4g [threads]` prints the environment as shell exports.
if (import.meta.main) {
  const budget = parseBudget(process.argv[2] ?? process.env.JUNO_MEMORY_BUDGET ?? '4g')
  const threads = Number(process.argv[3] ?? process.env.JUNO_RUNNER_JOB_CORES ?? Math.max(1, availableParallelism() - 2))
  for (const [key, value] of Object.entries(budgetEnv(budget, threads))) console.log(`export ${key}=\${${key}:-${value}}`)
}
