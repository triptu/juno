# 0005. Views are props-only components reviewed through a fixture gallery, not Storybook

Status: proposed, 2026-10-12

## Context

The UI must be easy to change without touching logic, and design-review agents need to see every surface in every state without driving the whole app. The usual answer is Storybook. It brings its own builder and configuration, and StyleX plus a pnpm monorepo of source-shipped packages is exactly the kind of setup where a second build pipeline drifts from the first.

## Decision

Four layers with enforced dependencies: `@juno/tokens` (CSS variables) → `@juno/ui` (primitives) → `@juno/views` (feature components: props in, callbacks out; the prop types are the contract's view models) → containers in `apps/desktop/src/renderer` (atoms to props). `views` does not declare `@juno/state`, `effect` or `@juno/engine` as dependencies, so pnpm's strict layout plus `scripts/check-deps.mjs` make a logic import impossible. A view that needs the current time takes `now` as a prop.

Every view exports `fixtures.ts`, a record of named prop sets. `apps/gallery` is a plain Vite + React app using the same StyleX plugin config, with a route per view and fixture and query parameters for theme and density. A Playwright project screenshots every route in light and dark into `apps/gallery/shots/`. Reviewers and agents read the PNGs; a diff against the previous run is the visual regression check. Fixtures double as seed data for `fake-slack` where shapes overlap.

## Consequences

- A designer edits tokens, primitives or views and sees the result in the gallery in seconds, with no engine, no sign-in and no Electron.
- One build pipeline to maintain; the gallery is a few hundred lines we own.
- Interactive stories (controls, actions panel) are not provided; fixtures are code. For state-heavy components, a fixture can render a tiny local-state wrapper, which stays inside `apps/gallery`.
- Containers are not covered by the gallery; they are covered by e2e.
