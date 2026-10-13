# @juno/tokens

The only place a colour, size, radius, shadow, font or duration is written down. Everything is a StyleX `defineVars` group whose keys are literal CSS variable names, so `colors['--background']` in StyleX and `var(--background)` in plain CSS are the same thing.

## Files

| File | What it holds |
| --- | --- |
| `src/tokens.stylex.ts` | Every variable group with its light, Coral value. |
| `src/themes.stylex.ts` | `dark` (colours, shadows, swatches) and a light and a dark theme for each of the eight accents. |
| `src/global.css` | Body defaults, scrollbars, `::selection`, reduced motion, theme-switch suppression. |
| `src/fonts.css` | `@font-face` imports for Figtree, Instrument Serif and JetBrains Mono from `@fontsource`. |

Import tokens through the subpath, never a barrel: `import { colors } from '@juno/tokens/tokens.stylex'`. Import the two stylesheets once from the app entry.

## Groups

| Export | Prefix | Examples |
| --- | --- | --- |
| `colors` | `--background`, `--surface-*`, `--secondary-*`, `--border-*`, `--foreground-*`, `--accent-*`, `--input-border`, `--overlay`, status | the base palette |
| `accent` | `--hl`, `--hl-fg`, `--hl-text`, `--hl-soft`, `--hl-nav`, `--hl-rule`, `--hl-ring`, `--focus-ring`, `--selection-background` | the accent and its derived mixes; the only accent variables components use |
| `accentSwatches` | `--swatch-<accent>` / `-fg` | the eight fills for the accent picker, with a dark override |
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

Apps call `applyTheme(theme, accent)` from `@juno/ui` (re-exported by `@juno/views`). It puts the `dark` classes and the accent's theme for that colour scheme on `<html>`, sets `color-scheme` and `data-accent`, and sets `data-theme-switching` on `<html>` while the classes swap so `global.css` turns transitions off for two frames.

## Rules the tokens encode

- Never `cursor: pointer`. `global.css` sets the arrow cursor on the body and the text cursor on text inputs and textareas; checkboxes, radios and ranges keep the arrow.
- The muted grey is `hsla(48, 5%, 42%)`, darker than the handoff, so meta text reaches 4.5:1 on paper. Muted text may sit on `--background`, `--background-subtle`, `--surface-default` and `--surface-hover`; on `--secondary-*` fills use `--foreground-subtle`.
- `--focus-ring` is the accent's text colour (4.5:1 or better on the page for every accent; ink keeps the info blue), never the pale selection colour. `--selection-background` is the accent at 28% over the page and is for text selection only.
- The cyan accent takes near-black `--hl-fg`; its off-white text would be 3.8:1. Unread counts never take the accent.
- Floating surfaces use `--pop-shadow` or `--card-ring` with a transparent 1px border, never a coloured border. Inputs keep `--input-border`.
