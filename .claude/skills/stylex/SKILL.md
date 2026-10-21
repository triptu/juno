---
name: stylex
description: Styling with StyleX in Juno. Use when writing or reviewing any UI code that calls `stylex.create`, adds or changes a design token, themes (dark mode, accents), or styles hover, focus, press and disabled states. Covers the token rules, the interaction rules and the toolchain pitfalls found so far.
---

# Styling with StyleX in Juno

Versions: `@stylexjs/stylex` and `@stylexjs/unplugin` 0.19.1. The reference implementations are
`packages/ui/src/Button.tsx` (states) and `packages/tokens/src/` (tokens and themes); copy their
shape, but if they use a raw value that now has a token, use the token. Rules come from `docs/design/handoff/SPEC.md` and `docs/design/tokens.md`.

## Rules

1. **Every design value comes from `@juno/tokens`.** Colours, spacing, radii, type sizes, line
   heights, fonts, shadows, durations, easing and layout sizes. `pnpm lint` runs `scripts/check-tokens.mjs` on UI, views and renderer StyleX calls.
   It rejects literal colours and lengths, including nested conditions and templates.
   Zero, percentages and 1px border/outline hairlines pass. For geometry exceptions,
   add a trailing `// tokens-allow: reason` on the declaration line. A module constant used in
   a style is checked as its value, and takes the allow comment on its own line. A `color-mix(`
   with a literal share ("currentColor 6%") is a raw colour. Runtime parameters are not
   evaluated; review those for token use.
   - Allowed raw values: `0`, `none`, `auto`, `transparent`, `1px` hairlines. Before writing any
     other number, search `tokens.stylex.ts` for it (focus ring, disabled opacity and
     font weights have tokens or are being added). A one-off size that no other component will
     share stays in that component as a named constant (`tokens.md` section 3, spacing); promote
     it to a token on the second use.
2. **Import tokens through the subpath, never a barrel.**
   `import { colors, spacing } from '@juno/tokens/tokens.stylex'`. Each group is a named export;
   read a token as `colors['--foreground-default']`. `packages/tokens/README.md` lists the groups
   and the naming scheme, and `tokens.stylex.ts` is the source of truth.
3. **Never `cursor: pointer`, except on links in message content that open outside the app.** Interactive elements use `cursor: 'default'`. The exception is marked `// external-link-cursor` in `MessageBody.tsx`. `pnpm lint` runs
   `scripts/check-no-pointer-cursor.mjs`, which fails on it in any other ts, tsx, css or html file.
4. **Hover only for hover-capable pointers**, and nested so that it falls back to nothing:
   ```ts
   backgroundColor: {
     default: colors['--secondary-default'],
     ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] },
     ':active': { default: colors['--secondary-active'], '@media (hover: hover)': colors['--secondary-active'] },
     ':disabled': colors['--secondary-default'],
   },
   ```
5. **Focus ring on `:focus-visible` only**: a 2px solid outline with 2px offset,
   `outlineStyle: { default: 'none', ':focus-visible': 'solid' }`. Never style plain `:focus`.
   Use the `--focus-ring` colour (and `--focus-ring-width`/`-offset`). `--selection-background` is
   the pale text-selection colour and fails contrast for a ring (`tokens.md` 1.8).
   The ring must never be cut off. Inside a box that clips (a scroller, `contain: paint` or
   `content`), give the box `ringRoom.inline`, `.block` or `.all` from `@juno/ui` (padding of
   `--focus-ring-room` taken back by a negative margin), pass `revealFocus` as a scroller's
   `onFocus`, or use the inset ring for items that fill the scroller edge to edge. A hand-written
   outset ring also sets `scrollMargin: sizes['--focus-ring-room']`. `apps/gallery/focus-ring.spec.ts`
   tabs through the main surfaces and fails on a cut ring.
6. **Buttons stay still on press and toggle.** No scale, translate, spring or transform transition.
   Hover and press colours change at once. Disabled controls use `pointerEvents: { default: 'auto', ':disabled': 'none' }`.
7. **Motion**: no transition for button hover and press feedback. Other motion uses the motion tokens. Set
   `transitionDuration: { default: ..., '@media (prefers-reduced-motion: reduce)': '0ms' }`.
8. **Components do not take `style` or `className`.** Omit them from props (as `ButtonProps` does)
   and expose variants instead. Combine styles with `stylex.props(a, b, cond && c)`; later wins.
9. **Plain CSS is limited to the global stylesheet** (`global.css`: reset, body, `::selection`) and
   `fonts.css`. It reads tokens as `var(--background)` and writes no colours of its own.

## Dark mode and accents

- Components never know the theme. No `prefers-color-scheme` media query, no `.dark &` selector,
  no import of `themes.stylex`.
- Dark values live in `themes.stylex.ts` as `stylex.createTheme(colors, { ... })`. `dark` is an
  array of themes (colours, shadows), so spread it: `stylex.props(...dark)`. `applyTheme()` in
  `packages/ui/src/theme.ts` (re-exported by `@juno/views`, which is how the desktop app reaches it)
  puts those classes on `<html>` (so portals on `<body>` are covered), sets `colorScheme` and pauses
  transitions for two frames while the classes swap.
- **One theme per token group can be active at a time.** `createTheme` returns
  `{ [groupHash]: 'themeClass groupHash' }`, so `stylex.props(darkColors, accentTheme)` built on the
  same `colors` group keeps only the last one (verified by compiling both). So an accent must not be
  another `createTheme(colors, ...)`. Accent keys (`--hl`, `--hl-fg`, ..., `tokens.md` 1.3) live in
  their own `defineVars` group with one `createTheme` per accent and colour scheme (`accents[name].light`
  / `.dark`), because a fill that reads on paper is too dark to glow on ink. Components use `--hl`,
  `--hl-text`, `--focus-ring` and friends, never a hex. The sidebar's counters take `--hl-count` and `--hl-count-fg` (the accent at reduced brightness); other counts stay grey.
- Tokens use `hsla()` literals, not `light-dark()`. If you do use `light-dark()`, keep
  `.browserslistrc` (`Chrome >= 152`). Without it lightningcss rewrites `light-dark()` into a
  `--lightningcss-light/dark` polyfill that silently does nothing.

## Adding or changing a token

1. Find the right group in `tokens.stylex.ts`. Add a key that starts with `--`, in kebab-case
   (`'--space-7'`). `--` keys emit a CSS variable with exactly that name; keys without it get a
   hashed name and cannot be used from `global.css` or tests. Value must be a static string or
   number (a function call fails at build: "Only static values are allowed").
2. If the value differs in dark, add it to the matching `createTheme` in `themes.stylex.ts`.
   Overrides may be partial; an unknown key is a type error, which catches typos.
3. A new group needs its own `createTheme` and, if it changes in dark, an entry in `dark`.
4. Add the row to `docs/design/tokens.md`. Renaming a key breaks `global.css` and the e2e colour
   checks, so search for the name first.
5. Use it in components as `group['--key']`. Run `pnpm build`: StyleX errors show up at build
   time, not in `pnpm typecheck`.

## Pitfalls

- **`.stylex` subpaths.** A file with `defineVars` or `createTheme` must be named `*.stylex.ts` and
  imported through a package subpath that also ends in `.stylex`. Re-exporting from `index.ts`
  fails with "Could not resolve the path to the imported file".
- **A top-level `default: null` removes the property, it does not keep it.** In a style applied after
  another (`stylex.props(styles.base, narrow)`), `width: { default: null, [NARROW]: '24px' }` drops
  `base`'s width at every size, not only under the query. State the wide value as the default
  (`ContextPill`'s narrow form, 10-17). `null` nested inside a condition (`':hover': { default: null, … }`)
  is fine: it means no hover value outside the media query.
- **A pseudo-class nested in a media query gets a doubled class** (`.x.x:hover`), so it outranks the
  same property's plain `:active` (`.y:active`) whatever their order: a press colour next to a
  `@media (hover: hover)` hover never shows under the pointer. Nest the press the same way (rule 4;
  Home's rows and `SuggestionChip`, 10-17, found by the feel suite's press checks).
- **Pseudo-class order is fixed by StyleX, not by your key order.** Priority, low to high:
  `:disabled` 92, `:hover` 130, `:focus-visible` 160, `:active` 170 (read from
  `@stylexjs/shared`). So `:hover` and `:active` beat `:disabled`. Set the disabled colour
  explicitly in every state, and use `pointer-events: none` so they cannot match.
- **A `createTheme` re-emits every variable of its group.** Never use one for a partial override on a
  child element (say, a different `--foreground-muted` inside one row): it also resets the group's
  other variables there and undoes the active dark or accent theme. Set the one variable in a
  `stylex.create` style instead (`'--foreground-muted': colors['--foreground-subtle']`, as
  `ListRow selected` does), or use a token that already has the right value.
- **`stylex.when` keys go inline in `stylex.create`.** `[stylex.when.ancestor(':hover')]: …` written
  inside the style object is compiled away; the same call stored in a module constant is left in the
  bundle, runs at load and throws, and the renderer shows a blank window (10-18). The ancestor
  carries `stylex.defaultMarker()` in its `stylex.props`.
- **Static values only.** `stylex.create` cannot call functions or read runtime values. For a value
  that varies at runtime use a function style: `stylex.create({ w: (px: number) => ({ width: px }) })`.
- **Workspace setup.** Packages ship TypeScript source and list `@stylexjs/stylex` as their own
  dependency. The plugin sits before `react()` in `electron.vite.config.ts` and gets
  `unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot }` so builds work from any cwd.
  The plugin writes its sheet after Vite has minified the CSS, so its own lightningcss pass minifies
  it (`lightningcssOptions: { minify }`, in the app's and the gallery's config alike); without that the sheet
  carried 21 KB of whitespace.
- **Fonts**: bundled `@fontsource` packages, imported once per app from `@juno/tokens/fonts.css`
  (Figtree, Instrument Serif, JetBrains Mono). Pick them through the `fonts` tokens. Instrument Serif
  has one weight (400); never set bold on it.
- **Main process** cannot use StyleX. The one raw colour there (`BrowserWindow.backgroundColor` in
  `main/window.ts`) must match `--background`; update both together.
- **Verify** as CLAUDE.md says (typecheck, lint, your own tests), plus
  `GALLERY_SHIFT_ONLY=<components> pnpm remote test:gallery` for anything that
  changes computed colours or states.
