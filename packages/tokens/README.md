# @juno/tokens

The only place a colour, size, radius, shadow, font or duration is written down. Everything is a StyleX `defineVars` group whose keys are literal CSS variable names, so `colors['--background']` in StyleX and `var(--background)` in plain CSS are the same thing.

## Files

| File | What it holds |
| --- | --- |
| `src/tokens.stylex.ts` | Every variable group with its light, default-accent value. |
| `src/themes.stylex.ts` | `dark` (colours and shadows) and the four accent themes. |
| `src/global.css` | Body defaults, scrollbars, `::selection`, reduced motion, theme-switch suppression. |
| `src/fonts.css` | `@font-face` imports for Inter and Instrument Serif from `@fontsource`. |

Import tokens through the subpath, never a barrel: `import { colors } from '@juno/tokens/tokens.stylex'`. Import the two stylesheets once from the app entry.

## Groups

| Export | Prefix | Examples |
| --- | --- | --- |
| `colors` | `--background`, `--surface-*`, `--secondary-*`, `--border-*`, `--foreground-*`, `--accent-*`, `--input-border`, `--focus-ring`, `--selection-background`, `--overlay`, status | the base palette |
| `accent` | `--hl`, `--hl-fg`, `--hl-soft`, `--hl-rule`, `--hl-ring` | the accent and its derived mixes; the only accent variables components use |
| `tints` | `--tint-<context>-bg` / `-fg` | `public`, `private`, `dm`, `resolved`, `warning`, `mention` |
| `hues` | `--hue-<name>` | the eight person colours for avatars |
| `shadows` | `--shadow-*`, `--card-ring`, `--pop-shadow` | drop shadows and the rings floating surfaces use instead of borders |
| `radii` | `--radius-<step>` | `xs` 4 to `bubble` 16 and `full` |
| `spacing` | `--space-<n>` | 4px scale in px, with `0-5` (2px), `1-5` (6px), `2-5` (10px), `3-5` (14px) |
| `fonts` | `--font-sans`, `--font-serif`, `--font-mono` | families |
| `weights` | `--weight-regular` / `-medium` / `-semibold` | 400 / 500 / 600 |
| `tracking` | `--tracking-tight` / `-normal` / `-wide` / `-none` | letter spacing |
| `text` | `--text-<role>-family` / `-size` / `-weight` / `-leading` / `-tracking` | one complete setting per type role (`ui`, `meta`, `body`, `row-title`, `page-title`, ...) |
| `motion` | `--duration-fast`, `--ease-out`, `--press-scale`, `--toast-life-*` | durations collapse under `prefers-reduced-motion` by themselves |
| `layout` | `--sidebar-width`, `--titlebar-height`, `--tab-height`, `--reading-width`, `--page-width*`, `--menu-width*`, ... | fixed shell dimensions |
| `sizes` | `--control-<px>`, `--tile-<px>`, `--avatar-<px>`, `--initials-<px>`, `--icon-<px>`, misc | control, tile, avatar and icon sizes named by pixel value |
| `z` | `--z-<layer>` | stacking order from `toolbar` (2) to `toast` (45) |
| `opacity` | `--opacity-disabled` / `-dim` / `-tab-icon` / `-kbd` | |

## Naming

- Prefix is the group, then the role or step, then the property: `--text-meta-size`, `--tint-private-fg`, `--radius-md-plus`.
- Sizes that the spec gives as a measurement are named by that number (`--control-28`, `--avatar-32`, `--icon-14`) so a measurement maps straight to a token. Sizes that are a position in a scale use the scale name (`--radius-lg`, `--space-3`).
- Role tokens (`text`) describe what the text is for, not how big it is. Add a role when a new kind of text appears; do not add a bare size.
- Dark-only values live in `themes.stylex.ts`. Anything mixed from the base palette (`tints`, `--hl-soft`) needs no dark override because `color-mix()` resolves on the same element the theme class sits on. For that to hold, always apply themes to `<html>`.

## Applying a theme

```ts
import * as stylex from '@stylexjs/stylex'
import { dark, accents } from '@juno/tokens/themes.stylex'

const { className } = stylex.props(...dark, accents.claret)
document.documentElement.className = className ?? ''
document.documentElement.style.colorScheme = 'dark'
```

Set `data-theme-switching` on `<html>` before swapping classes and remove it two animation frames later; `global.css` turns transitions off while it is present.

## Rules the tokens encode

- Never `cursor: pointer`. `global.css` sets the arrow cursor on the body and the text cursor on inputs.
- The muted grey is `hsla(48, 5%, 42%)`, darker than the handoff, so meta text reaches 4.5:1 on paper. Muted text may sit on `--background`, `--background-subtle`, `--surface-default` and `--surface-hover`; on `--secondary-*` fills use `--foreground-subtle`.
- `--focus-ring` is the info blue (3.9:1 on paper), not the pale selection colour. `--selection-background` is for text selection only.
- The cyan accent takes near-black `--hl-fg`; its off-white text would be 3.8:1.
- Floating surfaces use `--pop-shadow` or `--card-ring` with a transparent 1px border, never a coloured border. Inputs keep `--input-border`.
