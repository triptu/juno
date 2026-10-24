# Search tab mocks: interface review (2026-10-24)

A cross-discipline review (`better-interface`, with the accessibility, layout, writing, typography, colors and UI passes) of `mock.html` and its PNGs, after the field moved above the split, the reader became the live topic, the scoped ⌘F shot was added and ⌘K gained All. Each finding below says what was done with it.

## Scope and coverage

- **Scope:** every shot in `mock.html`: `tab-light`, `tab-dark`, `scoped-light`, `picker-light`, `words-light`, `answer-light`, `empty-light`, `states-light`, `palette-light`, `palette-messages-light` and `narrow-light` (with its minimum-window crop). These are static mocks for an Electron, React and StyleX app, so the review judges the design, not the mock's HTML.
- **Sources read:** `README.md` (this folder, the source of truth), the root `CLAUDE.md`, SPEC sections 6, 7, 8, 10, 15 and 17, `docs/design/inventory.md` (header, composer, palette) and `docs/design/tokens.md` (selection, focus ring, muted-on-fill, composer radius).
- **Not in scope:** keyboard and screen-reader behaviour in the built app, which only an implementation can show.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Selected row and current-match visibility, icon-only island controls, toggle state, the palette's tab row; contrast pairs measured (below) | 2 findings, plus requirements under Verification |
| Layout | Every PNG at 1440, 1100, 1056 and 560 px and the 336 px minimum page; band, filter row, islands, composer | 6 findings |
| Writing | Toggle labels, the four states, the palette group headings and last row, captions | 2 findings |
| Typography | Snippet truncation, numerals, quotes and ellipses, the type sizes in rows and islands | 1 finding |
| Colors | Muted text on the selected fill, the selection fill, match marks in both themes | 2 findings |
| UI | Island and composer radii, icon sizes, toggle affordance, the landing flash | 1 finding |

## Findings

| # | Severity | Domain | Location | Before | After | Why | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Layout | `narrow-light`, the reader header and filter row at the minimum window | At 336 px for the page the filter row needs about 497 px and the header islands about 554 px (measured from the 1100 px render: back 126, step 113, actions 124, pill and title at least 167, gaps 24) | The toggles wrap to their own line under the filters. Under 480 px the header keeps Back to results as an icon at the start of the left island, the place pill as its icon in its tint, the title, and the step arrows with ⋯; Open in new tab, Resolve and Juno are in ⋯, which already lists them | Controls overlap or clip at a supported width | Fixed: new "Minimum window" crop in `narrow-light`. README needs the rule (see the reply) |
| 2 | HIGH | UI | Reader in `tab-*`, `scoped-light`, `narrow-light` | The current match ("2 of 5") differed from the other marks only by the landing flash, which fades | The current match's mark keeps a stronger fill: accent 24% over the page in light (1.35:1 against the page, against 1.13:1 for the other marks), 30% in dark (1.71:1 against 1.24:1); the text on it stays at 11.5:1 and 8.6:1 | A state carried by motion alone: once the flash fades, or with reduced motion, nothing says which match the arrows are on | Fixed in the mock as `--mark-current`. Needs a new token in `tokens.md` |
| 3 | HIGH | Colors | Selected result row, its time | The previous mock drew the time on the selected row in `--foreground-muted`: 4.39:1 on `--secondary-default` | `--foreground-muted-on-fill`, the project's token for that pair: 5.65:1 on the old fill, 5.58:1 on the new one | Body text under 4.5:1 (WCAG 1.4.3) | Fixed |
| 4 | MEDIUM | Accessibility | Selected result row, all result shots | The selected row was told apart from the page by a fill at 1.12:1 (light) and 1.31:1 (dark) | While the list has focus (typing in the field counts, as in ⌘K), the selected row takes `--hl-nav`, the sidebar's selected-page tint. The hue now ties the row to the coral flash in the reader. Its contrast is still 1.14:1 | WCAG 1.4.11 asks 3:1 for a state indicator. It is the project-wide selected-row token, so it is reported once here | Fixed (hue). Tushar decided on 10-24 that Search and the sidebar keep the quiet tint, not 3:1: a row that takes focus is selected, so the tint always shows where focus is, and the Search list's focused tint is `--hl-select`, mixed over the page so it is never fainter than the unfocused fill |
| 5 | MEDIUM | Layout | Filter row, every shot | "Apps hidden" and "Automated hidden" were plain text with no caret or fill, so they read as a status line | Each leads with a 13px eye-slash icon (eye when shown); same height and padding as the menus | Controls must look like controls | Fixed |
| 6 | MEDIUM | Layout | Filter row, every shot | The sort sat last, after a hairline, with the toggles before it; README section 6 puts the toggles at the end | From, In, Date, Has, then the sort after a 10px space, then the toggles at the end. The hairline is gone, and at narrow widths the toggles wrap as one group | Group with space, not lines; matches README section 6 | Fixed |
| 7 | MEDIUM | Layout | `words-light` | The suggestion line arrives after a pause between the field and the filter row, pushing the filters and the list down 32px | Show it inside the field, at its trailing end, where the full-width field now has room; fall back to under the field only when it does not fit | Nothing should move after a pause (README section 7 says suggestions never delay or disturb results; `CLAUDE.md` says no shifting) | Not applied: README section 7 says "under the field". Listed in the reply |
| 8 | MEDIUM | Writing | `states-light`, only hidden rows match | "Nothing in your other conversations. 4 matches from apps and automated channels." with "Show them" | "4 matches, all from apps and automated channels." with "Show 4 matches" | "Other" has no referent; "them" makes the button's result vague | Not applied: README section 6 fixes this copy. Listed in the reply |
| 9 | MEDIUM | Typography | `scoped-light` result rows | Snippets such as "…the 4% cap holds and the notice …" cut the matched words off | Start a few words before the match: "…and the **notice period** is 90 days" | README section 3: the matched words are always visible | Fixed |
| 10 | LOW | Writing | `scoped-light` | The list is newest first, so the selected row is third in the list but the reader says "2 of 4", counted in thread order | Say in README that the count follows the thread's reading order, or start a scoped search sorted Oldest | Two orders for the same four matches on one screen | Not applied: behaviour. Listed in the reply |
| 11 | LOW | Layout | `palette-light` | "⌘2" appears on both Conversations and "Pages, settings and commands" | Keep the hint on Conversations and Topics and messages only | The same key twice reads as a mistake, and the third group's name does not match the tab it opens | Not applied: README section 1 says each group's heading has a key. Listed in the reply |
| 12 | LOW | Layout | Reader, every shot with a short thread | The list was anchored at the top, leaving a blank band above the composer | The list keeps its bottom, as the topic view does (SPEC 7); a thread that fits sits on the composer | No reserved blank space; match the real app | Fixed |
| 13 | LOW | Layout | `states-light` at 560 px | The toggles touched the sort | 12px minimum clearance before the toggles, and they wrap when it is not there | Borderless controls need clearance | Fixed |
| 14 | LOW | UI | Composer in every reader | Radius 12 | `--radius-composer` 20, as the topic composer is | One detail done two ways | Fixed |

### Rejected

- **Make the selected row 3:1, such as a solid accent row with light text as in a focused macOS list.** Rejected: it is loud next to Juno's calm rows. Tushar decided to keep the quiet tint in Search and the sidebar (finding 4).
- **Draw the focus ring around the selected row.** Rejected: focus stays in the field while Up and Down move the selection (the ⌘K pattern, `aria-activedescendant`), so the row is the active option, not the focused element, and a coral ring on every arrow press is noisy.
- **Bring back a text "Open in new tab" button in the reader header.** Rejected: island controls are icons with their name as the tooltip and accessible name (SPEC 7, inventory section 5), and the text button pushed the title into an ellipsis at 1440.
- **Cap the field's width (for example 720 px) instead of spanning the tab.** Rejected: a capped field leaves a ragged right edge above the reader at 1440 and changes nothing at 1100. Spanning the tab keeps its edges on the panes' edges at every width, gives chips room, and needs no new width token.

## Verification

Passed:

- Contrast pairs computed from the mock's token values (sRGB, with OKLCH `color-mix` as CSS Color 4 defines it), script in `/tmp/contrast/c.mjs`:

  | Pair | Ratio |
  | --- | --- |
  | Light muted snippet on the page | 4.93 |
  | Light subtle (senders, filters, toggles) on the page | 6.34 |
  | Light muted-on-fill on `--secondary-default` / on `--hl-nav` | 5.65 / 5.58 |
  | Light muted on `--secondary-default` (the old time) | 4.39 (fail) |
  | Light selected fill against the page: `--secondary-default` / `--hl-nav` | 1.12 / 1.14 |
  | Light text on a mark / on the current mark | 13.79 / 11.53 |
  | Light mark / current mark against the page | 1.13 / 1.35 |
  | Light mark against the flash row | 1.05 |
  | Light muted on the palette's active row | 4.56 |
  | Dark muted on the page / muted-on-fill on the selected fill | 6.56 / 5.01 |
  | Dark selected fill against the page: `--secondary-default` / `--hl-nav` | 1.31 / 1.21 |
  | Dark text on a mark / on the current mark | 11.86 / 8.59 |
  | Dark mark / current mark against the page | 1.24 / 1.71 |

- Every PNG inspected after each render (`node render.mjs`, one at a time, load under 5): alignment, clipping, symmetry, overlap and agreement with the topic header in `docs/design/header/b-light.png`.

Not verified (needs the built app):

- Accessible names of the icon-only controls. Required: "Open in new tab" (⌘↵), "Previous match" (⌘↑), "Next match" (⌘↓), "Back to results" (Esc), "More", each also its tooltip.
- The toggles' semantics. Their label changes ("Apps hidden" to "Apps shown"), so each is a plain button whose name is its label, with no `aria-pressed` as well.
- The keyboard walk: Up and Down from the field, Tab into the reader's composer, Esc back to the list, ⌘1 to ⌘3 in ⌘K.
- 200% zoom, and the rendered contrast in the app.

## Verdict

`Approve` for the mocks as they stand: the three HIGH findings are fixed in `mock.html`. Finding 1 stays fixed only if README adopts the minimum-width rule, and finding 2 needs the `--mark-current` token added to `tokens.md`. Findings 7, 8, 10 and 11 are open for Tushar.
