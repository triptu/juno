# @juno/views

Feature views: React components built from `@juno/ui` that take view models and callbacks and nothing else. Containers in `apps/desktop/src/renderer/containers/` wire atoms to them. See `docs/architecture.md` sections 1 and 8, and `docs/development.md` ("Adding a feature").

## Public API

- The views: `Shell` (the two panes, or a drag strip over a page when signed out), `Sidebar` (title bar icons, nav, quick filters that switch on mouse down and name their dot ("Channels, unread"), a `status` slot under them, scope chip; takes the list as children), `TopicList` (sticky Pinned and Recent labels over rows the owner renders, the empty states with their next step, arrow-key focus; `onRowFocus` tells the owner which row has focus for the roving tabindex), `TopicRow` (one chat-style row from a contract `TopicRow`, memoized; the Resolve check in a reserved slot), `AccountMenu` (the avatar popover's content), `Workspace` (tab strip placeholder over the empty page), `SignInView`, `SessionView`, `EngineStatusView` (the diagnostics line), `EngineNotice` (the status line under the sidebar's filters: offline, rate limited, or stopped with Restart), `AppInfoView`, `AppearanceSettings` (theme and accent; in the account menu until Preferences exists), `ChannelIconPicker` (not wired yet), each with its props type.
- `relativeTime(at, now)`, `hueFor`, `initials`: the row's formatting helpers, repeated from `@juno/domain` because views cannot depend on it.
- `src/fixtures/topics.ts`: invented `TopicRow` view models shaped like the fake Slack seed, shared by the sidebar and row fixtures.
- Copy lives in the views and their fixtures and follows `docs/design/friendly-layer.md` §7 within SPEC §17: short titles, one-sentence bodies, no exclamation marks, "Juno" or "I" only on the sign-in and Juno surfaces.
- `applyTheme`, `accentNames`, `defaultAccent`, `AccentName`, `ThemeName`, re-exported from `@juno/ui`. The desktop app does not depend on `ui`, so it reaches the theme entry point here.
- `@juno/views/fixtures`: `fixtures`, every view's fixture sets keyed by view name. The gallery renders them, and each gets a screenshot in light and dark.

Every view has a `<View>.fixtures.tsx` next to it, registered in `src/fixtures.ts`. Group its states under headings in product words (`Data: loading, empty, error, long`; `Session: expired`) as `@juno/ui`'s README shows. List only states the view's container can produce today: the lines and props its container passes, not copy it might pass later. A loading state holds still; nothing resolves on a timer.

## Must not

- Import `@juno/state`, `@juno/engine`, `@juno/store`, `electron`, Node built-ins or `effect` (`check-deps` enforces this for any `views/` directory).
- Mention `window.juno`. A container passes a callback.
- Hold state beyond local UI state such as a hovered or open flag.
- Use raw colours or sizes. Values come from `@juno/tokens` through `@juno/ui` primitives; see the stylex skill.
- Take `style` or `className`.

## Testing

Visual and behaviour checks run in the gallery, not in the package: `pnpm gallery` to look, `pnpm gallery:shots` for screenshots, `pnpm test:gallery` for behaviour (mouse-down activation, cursor rule, state switcher, no layout shift on hover, press or focus). In the gallery a view is one state per address (`#/SignInView?__state=failure/keychain`), and `j` `k` `[` `]` move between states and components. A view's user flow is covered by an e2e spec against the built app.
