# @juno/views

Feature views: React components built from `@juno/ui` that take view models and callbacks and nothing else. Containers in `apps/desktop/src/renderer/containers/` wire atoms to them. See `docs/architecture.md` sections 1 and 8, and `docs/development.md` ("Adding a feature").

## Public API

- The views: `Shell` (title bar and page), `EngineStatusView`, `AppInfoView`, `ThemeToggleView`, each with its props type.
- `applyTheme`, `AccentName`, `ThemeName`, re-exported from `@juno/ui`. The desktop app does not depend on `ui`, so it reaches the theme entry point here.
- `@juno/views/fixtures`: `fixtures`, every view's fixture sets keyed by view name. The gallery renders them, and each gets a screenshot in light and dark.

Every view has a `<View>.fixtures.tsx` next to it, registered in `src/fixtures.ts`. Add a fixture for each state a reviewer needs to see: empty, loading, error, long text.

## Must not

- Import `@juno/state`, `@juno/engine`, `@juno/store`, `electron`, Node built-ins or `effect` (`check-deps` enforces this for any `views/` directory).
- Mention `window.juno`. A container passes a callback.
- Hold state beyond local UI state such as a hovered or open flag.
- Use raw colours or sizes. Values come from `@juno/tokens` through `@juno/ui` primitives; see the stylex skill.
- Take `style` or `className`.

## Testing

Visual and behaviour checks run in the gallery, not in the package: `pnpm gallery` to look, `pnpm gallery:shots` for screenshots, `pnpm test:gallery` for behaviour (mouse-down activation, cursor rule). A view's user flow is covered by an e2e spec against the built app.
