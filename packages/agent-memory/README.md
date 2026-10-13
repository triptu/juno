# @juno/agent-memory

Juno Agent's memory rules as pure functions: node keys and versions, due order (integer cross-multiplication), batches, view rendering, the local-window selection, the dependency closure, the request partition and budget, pin span rules, ready queues and the compaction task text. Plan v3 §4 and §5 define them. `specs/agent-memory.qnt` (WP2) checks the same rules.

Status: empty. WP5 (Astra) writes `src/**` and its property tests, starting with `src/index.ts` (the `exports` entry) and the `typecheck` and `test` scripts in `package.json`.

## Must not

- Do I/O, define Effect services or import pi. Only `{ Schema }` from `effect` is allowed (`check-deps`).
- Import Electron or any Slack package.

Depends on nothing in the workspace. `@juno/agent` uses it.
