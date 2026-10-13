# @juno/agent-cards

Juno Agent's card catalogue: the card kinds of plan v3 §12, their payload schemas (Effect Schema, plus TypeBox for the model-facing tool parameters), canonical payloads and their digests (JCS, §6.2), the expansion of a batch card into child actions, and the card status machines.

Status: empty. WP6 (Astra) writes `src/**`, starting with `src/index.ts` (the `exports` entry) and the `typecheck` and `test` scripts in `package.json`.

## Must not

- Render UI or do I/O. Only `{ Schema }` from `effect` is allowed (`check-deps`).
- Import Electron or any Slack package.

Depends on nothing in the workspace. `@juno/agent-contract` and `@juno/agent` use it.
