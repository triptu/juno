---
name: stylex
description: Styling with StyleX in Juno. Use when writing or reviewing any UI code that calls `stylex.create`, adds or changes a design token, themes (dark mode, accents), or styles hover, focus, press and disabled states. Covers the token rules, the interaction rules and the toolchain pitfalls found so far.
---

# Styling with StyleX in Juno

Versions: `@stylexjs/stylex` and `@stylexjs/unplugin` 0.19.1. The reference implementations are
`packages/ui/src/Button.tsx` (states) and `packages/tokens/src/` (tokens and themes). Copy their
shape. Rules come from `docs/design/handoff/SPEC.md` and `docs/design/tokens.md`.

## Rules

1. **Every design value comes from `@juno/tokens`.** Colours, spacing, radii, type sizes, line
   heights, fonts, shadows, durations, easing and layout sizes. Nothing checks this for you:
   StyleX compiles `color: '#fff'` without complaint, so review for it.
   - Allowed raw values, as in `Button.tsx`: `0`, `none`, `auto`, font weights, 2px ring width,
     the 0.96 press scale. A one-off size that no other component will share stays in that
     component as a named constant (`tokens.md` section 3, spacing); promote it to a token on the second use.
2. **Import tokens through the subpath, never a barrel.**
   `import { colors, spacing } from '@juno/tokens/tokens.stylex'`. Only `./tokens.stylex` and
   `./themes.stylex` are exported. Token groups: `colors`, `shadows`, `radii`, `spacing`, `fonts`,
   `type`, `motion`, `layout`. Read a token as `colors['--foreground-default']`.
3. **Never `cursor: pointer`.** Interactive elements use `cursor: 'default'`. `pnpm lint` runs
   `scripts/check-no-pointer-cursor.mjs`, which fails on it in any ts, tsx, css or html file.
4. **Hover only for hover-capable pointers**, and nested so that it falls back to nothing:
   ```ts
   backgroundColor: {
     default: colors['--secondary-default'],
     ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] },
     ':active': colors['--secondary-active'],
     ':disabled': colors['--secondary-default'],
   },
   ```
5. **Focus ring on `:focus-visible` only**: 2px solid `colors['--selection-background']`, offset
   2px, `outlineStyle: { default: 'none', ':focus-visible': 'solid' }`. Never style plain `:focus`.
   (`tokens.md` 1.8 flags that this blue is low contrast and proposes a `--focus-ring` token; until
   that is decided, use `--selection-background`.)
6. **Press scale**: `transform: { default: 'none', ':active': 'scale(0.96)', ':disabled': 'none' }`
   and `pointerEvents: { default: 'auto', ':disabled': 'none' }`. Disabled controls never scale.
7. **Motion**: at most `motion['--duration-fast']` (150ms) for hover and press feedback. Set
   `transitionDuration: { default: ..., '@media (prefers-reduced-motion: reduce)': '0ms' }`.
8. **Components do not take `style` or `className`.** Omit them from props (as `ButtonProps` does)
   and expose variants instead. Combine styles with `stylex.props(a, b, cond && c)`; later wins.
9. **Plain CSS is limited to `apps/desktop/src/renderer/global.css`** (reset, body, `::selection`).
   It may read tokens as `var(--background)`. No colours are written in it.

## Dark mode and accents

- Components never know the theme. No `prefers-color-scheme` media query, no `.dark &` selector,
  no import of `themes.stylex`.
- Dark values live in `themes.stylex.ts` as `stylex.createTheme(colors, { ... })`. `dark` is the
  array `[darkColors, darkShadows]`. `applyTheme()` (`renderer/state/theme.ts`) puts the classes
  from `stylex.props(...dark)` on `<html>` so portals on `<body>` are covered, and sets
  `colorScheme`.
- **One theme per token group can be active at a time.** `createTheme` returns
  `{ [groupHash]: 'themeClass groupHash' }`, so `stylex.props(darkColors, accentTheme)` built on the
  same `colors` group keeps only the last one (verified by compiling both). Do not make accents
  as another `createTheme(colors, ...)`. Put the accent keys (`--hl`, `--hl-fg`, `--hl-soft`, see
  `tokens.md` 1.3) in their own `defineVars` group, default them to `var(--accent-default)` etc.,
  and add one `createTheme` per accent. Components then use `--hl`, never a hex value.
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
- **Pseudo-class order is fixed by StyleX, not by your key order.** Priority, low to high:
  `:disabled` 92, `:hover` 130, `:focus-visible` 160, `:active` 170 (read from
  `@stylexjs/shared`). So `:hover` and `:active` beat `:disabled`. Set the disabled colour
  explicitly in every state, and use `pointer-events: none` so they cannot match.
- **Static values only.** `stylex.create` cannot call functions or read runtime values. For a value
  that varies at runtime use a function style: `stylex.create({ w: (px: number) => ({ width: px }) })`.
- **Workspace setup.** Packages ship TypeScript source and list `@stylexjs/stylex` as their own
  dependency. The plugin sits before `react()` in `electron.vite.config.ts` and gets
  `unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot }` so builds work from any cwd.
- **Fonts**: bundled `@fontsource` packages through the `fonts` tokens. Instrument Serif has one
  weight (400); never set bold on it.
- **Main process** cannot use StyleX. The one raw colour there (`BrowserWindow.backgroundColor` in
  `main/window.ts`) must match `--background`; update both together.
- **Verify** with `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` for anything
  that changes computed colours or states.
