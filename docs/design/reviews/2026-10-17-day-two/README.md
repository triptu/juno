# Design review, 2026-10-17: the surfaces built on 10-16

The surfaces that about 20 branches built on 10-16, reviewed together on `batch-3` before it lands on main. They were checked against `docs/design/handoff/SPEC.md` (§§ 5 to 9, 12 to 14 and 17), `inventory.md`, `tokens.md`, `primitives.md` and the stylex skill, using the method of `../2026-10-16/`. Code was read at `5898d561` (`batch-3`). The fixes are on `design-review-1017`.

## Scope and how it was checked

- **Surfaces.**
  1. Settings, one page: General, Appearance, Notifications, Ignored, Juno, Connections, Backup & This Mac and About. Also the avatar menu.
  2. The Juno panel: the floating inspector, the context line, Catch me up, and the Juno tab.
  3. Tabs: the strip, "+", the topic header's title switcher, ⋯, Rename and the new-tab setting.
  4. New chat with Frequent, and Home during and after the first sync.
  5. Integration message cards (attachments and Block Kit), the `:emoji:` and @ suggestions, the message toolbar's thread action and external link cursors.
  6. Set up Juno, Connections with its compact rows and the Configure sheet, and the auto-review Change card.
- **Gallery.** `gallery:shots` for 21 components, light and dark, run from `batch-3` (`before`) and again for the changed components from this branch (`after`). The shots include the gallery's narrow and minimum-window states. Measurements and Tab walks were taken in the built gallery with `harness/probe.mjs` and `harness/tabwalk.mjs`. Contrast was measured with `harness/contrast.js`, which paints each colour through a canvas so `oklch()` and `color-mix()` backgrounds read correctly. Run them with the built gallery served on `GALLERY_PORT`, for example `node harness/probe.mjs SettingsPage sections/general light 1100 '<expression>'`, with `PW` pointing at `@playwright/test`.
- **Files.** `before/` and `after/` hold gallery shots, and `compare/` stacks before over after for each fix (a pink rule between them).
- **Not reviewed.** VoiceOver itself (roles and names were read from the DOM). Native menus. The sidebar's first-sync progress line, which another agent is moving into the header now. The app harness: every flow in scope has a gallery state, so no app run was needed. The desktop e2e for the switcher change did run (see Verification).

What held up:

- **Dark mode contrast.** No text under 4.5:1 on any measured surface in dark: Settings General and Juno, the Juno panel (context and covers), New chat Frequent, Home syncing, the switcher, Connections, Configure, Set up Juno, the tab strip and the Change card.
- **The Juno panel** floats 8px from the window's end and bottom, and its composer sits 12px from the panel's sides and bottom. The context line starts on the composer's text edge. The panel is an `aside` named "Juno".
- **Tabs** use a roving tabindex: one Tab stop in the tablist, the arrows move between tabs. "+" is named "New chat ⌘T".
- **Settings' section list** marks the open section with `aria-current="page"` and keeps the 10px inset.
- **External links.** In the message cards only the PR title link (an outside URL) shows the pointer. Everything else keeps the arrow.
- **Suggestions.** The @ list lines its names up under the typed token. The `:emoji:` list does the same until the window edge stops it, so at the start of the field it sits at the composer's edge.
- **Connections.** The compact rows hold the 15px inset, every server button is the same secondary pill, and the Configure columns line up (`geometry.spec.ts` already checks this).

## Findings, worst first

Severity: **high** breaks the surface or traps the keyboard user. **Medium** is a visible defect under the existing rules, or a keyboard or contrast miss. **Low** is polish.

### 1. Settings rows started 2px further left in four sections. Medium. Fixed.

Settings is now one page, but its sections came from two places. The Juno, Connections, Backup and Notifications rows start 15px from the card edge (a 14px row inset plus the 1px border). General, Appearance, Ignored and About used `Surface padding="md"`, so they start 13px from the edge. Switching sections in the list moves every label 2px.

- Evidence: `before/01-settings-general-*`, and measured: General, Appearance and About 13px, Juno 15px.
- Source: `packages/views/src/SettingsSections.tsx`.

**Fix.** Those cards keep their 12px top and bottom padding and take 14px at the sides, so every Settings row starts 15px in. `settings.spec.ts` checks every card of General, Appearance, Ignored and About against the Juno rows. The inventory's Appearance line said "padding `8 10 8 14`, control right", which matched neither version of the code. It now describes what is built.

- Compare: `compare/01-settings-general-*`, `compare/01b-settings-appearance-*`.

### 2. The topic switcher opened with two rows lit, and the arrows could leave the list. Medium (keyboard). Fixed.

The switcher opened with the keyboard highlight on Main and the selected fill on the topic on screen. Both use a tan fill with nearly the same tone (`rgb(244,242,235)` and `rgb(241,238,228)` in light), so the user cannot tell which row Enter opens. The list is also capped at 360px but did not scroll to the highlighted row, so ↓ past the fold moved the highlight out of sight.

- Evidence: `before/02-switcher-thread-*`.
- Source: `packages/views/src/TopicSwitcher.tsx`.

**Fix.** The switcher opens with the highlight on the topic on screen, scrolled into view, as a Mac pop-up button opens on its current item. Typing a query moves it to the first match, as before, and a row the arrows reach scrolls into view. The pointer still never scrolls the list. `list-geometry.spec.ts` checks that one row is lit on a thread and on Main. `e2e/topic.spec.ts` checks the highlight on open and now uses Home before Enter to reach Main. The inventory is updated.

- Compare: `compare/02-switcher-thread-*`.

### 3. Muted text on a selected option row was under 4.5:1. Medium (contrast). Fixed.

In light, the switcher's selected row printed "14 replies · 4m" at 4.4:1 on `--secondary-default`. `ListRow` already avoids this by pointing `--foreground-muted` at `--foreground-subtle` on a selected row (tokens.md 1.7), but `OptionRow` did not. The same applies to New chat's pickers.

**Fix.** `OptionRow`'s selected style makes the same override. `list-geometry.spec.ts` checks that the selected row's second line uses the subtle colour. The contrast probe now finds nothing under 4.5:1 on the switcher in either theme.

### 4. The card header's dot was in body type. Low. Fixed.

"Change · Notion · Offsite agenda". The first dot was a bare span in the card's 14.5px body type beside 12.5px meta text, so it sat 3px higher than the words. It also had 8px flex gaps on each side, while the dot inside the source used a space. The header affects every Juno card with a source: Change, Connect, Send message and T3 Code questions.

**Fix.** The dot is meta text with a space on each side, on the label's baseline, and the label, dot and source read as one line. `list-geometry.spec.ts` checks the size and baseline on the Change and Connect cards.

- Compare: `compare/04-change-card-header-*`.

### 5. The gallery's topic header showed a title the app never draws. Low. Fixed.

The app always gives the title its switcher (a dialog button). The gallery fixtures gave none, so the title was the fallback menu button. That made the menu-open states draw the title pressed beside a pressed ⋯ (`before/03-header-menu-open-*`), and the hover, press and focus states shot the wrong control.

**Fix.** The fixtures pass a closed switcher, so the title is the dialog button and only ⋯ shows pressed while the menu is open. The interaction states target `h1 button`. Compare: `compare/03-header-menu-open-*`.

### 6. The switcher's width in the gallery and the inventory was 360. Low. Fixed.

The app's popover is `--menu-width-browse`, 300px. The inventory said "`--browse-width` 360" (no such token), and the `TopicSwitcher` gallery frame was 360 wide, so the gallery showed longer titles than the app. Both now say 300.

### 7. Settings had two row layouts. Medium. Fixed (Q1).

General and Appearance put the control in a fixed column after a 104px label (`--settings-label-width`), at the leading side. Juno, Connections, Backup and Notifications put the controls at the trailing edge, as macOS System Settings does (`before/01-settings-general-light`, `before/SettingsPage-sections-juno-dark`). On one page, "New tabs open" has its segmented control 104px in, while "Chat" has its select at the far end. Either layout is fine alone. Choosing one is a product call, and it changes four views.

**Decided 10-17 (Q1): trailing controls.** General and Appearance drop the 104px label column (`--settings-label-width` is removed): the label starts the row and the control ends it, 15px from the card, as on the Juno rows and in System Settings. Checkboxes keep their label after the box, as macOS draws them (General's "Use fast classifier", About's update setting, Juno's "Juno is paused"). `settings.spec.ts` checks each control's end.

- Compare: `compare/11-settings-general-*`, `compare/11b-settings-appearance-*`.

### 8. Every tab's Close button was a Tab stop. Medium (keyboard). Fixed (Q2).

From the active tab, Tab walks through each tab's Close button before it reaches "+" and the page (`harness/tabwalk.mjs Tabs strip/thirty-seven` gives eight "Close tab" stops in a row, and 37 with 37 tabs). Close is also inside the `tab` element, which makes it an interactive control nested in another. Delete on a focused tab and ⌘W already close a tab, so the buttons need not be stops. This is deliberate today (`closeWithKeyboard` in the e2e driver, the `narrow-focus-close` gallery state), so it is left open.

**Decided 10-17 (Q2): not Tab stops.** Each tab is a plain box (`data-tab`) holding the `tab` element and, beside it, the Close button, so no control sits inside another. Close is `tabIndex=-1`. The tab names it with `aria-actions`, which Chromium exposes as the tab's action for VoiceOver (checked in Chrome 155 through the accessibility tree; it is dropped when the button is inside the tab or `aria-hidden`), and sets `aria-keyshortcuts="Delete"`. Delete and ⌘W close a focused tab. The button is drawn where it was, 7px from the tab's end, and on a narrow inactive tab it still shows over the label on hover. From the active tab, Tab now goes to "+".

- The e2e driver's `closeWithKeyboard` focuses the tab and presses Delete. `tabs.spec.ts` also checks that Tab goes from the active tab to "+". The gallery's `narrow-focus-close` state is now `narrow-focus-tab`, the active tab with keyboard focus, since an inactive tab never takes keyboard focus.
- `tabs-geometry.spec.ts` checks the sibling, the action, the Tab order and the 7px.
- `Tab` and `TabStrip` are now in `Tabs.tsx` and `TabStrip.tsx`.
- Compare: `compare/12-tabs-narrow-focus-*`.
- Not checked: VoiceOver itself, and the action in the Electron 44 build, whose Chromium may differ from the Chrome 155 used for the check.

### 9. Two-line option rows were 48.2px, not 44. Low. Fixed (Q3).

The switcher's and New chat's thread rows are `OptionRow size={44}`. The label inherits body leading (1.6, 23.2px) and the meta line uses `normal`, so each row is 48.2px. That is 4px taller than the inventory says, and every row after the first starts on a fractional pixel. The fix is a type decision for two-line rows (a fixed title and meta leading), and it touches every picker.

**Decided 10-17 (Q3): 44px.** `OptionRow size={44}` puts its title on a 20px line (`--text-option-title-leading`) and its meta on a 16px line (`--text-option-meta-leading`) with no gap, 4 + 20 + 16 + 4. A label passed as a `Text` takes the row's leading (`lineHeight: 'inherit'`), as the switcher's does. New chat's Main row now uses the 12.5px meta line under its title, as the switcher's does (it used the 11.5px tag type). `list-geometry.spec.ts` checks every row of the switcher and New chat's thread picker.

- Compare: `compare/13-switcher-*`, `compare/13b-newchat-threads-*`.

### 10. In the switcher, Main's title and the thread titles started on different edges. Low. Fixed (Q4).

Main has a 15px `chat-text` icon in a leading slot. Threads have no icon, so the thread titles start about 25px left of "Main" (`before/02-switcher-thread-light`). The options are to drop Main's icon (its second line already says what it is) or to give thread rows an empty leading slot.

**Decided 10-17 (Q4): no icon.** Main has no icon in the switcher, nor in New chat's thread picker, which is the same list, so every title starts on one edge. `list-geometry.spec.ts` checks the edge in both.

### 11. Set up Juno and Settings › Juno drew the API key row differently. Low. Fixed.

Set up Juno shows a saved key as the field's placeholder, "Key set" (`before/SetUpJunoView-openrouter-model-chosen-light`). Settings › Juno shows a "Key set" chip beside the field and keeps "sk-or-…" as the placeholder (`before/SettingsPage-sections-juno-dark`). It is the same row on two screens, and it should have one look.

**Fixed 10-17.** Set up Juno shows a saved key as Settings does: the "Key set" chip beside the field, and the field keeps "sk-or-…". `settings.spec.ts` compares the two screens.

- Compare: `compare/15-setup-key-*`.

### 12. Card buttons put the default first. Low. Fixed (Q5).

The Change card reads Apply (primary), then Dismiss. Every card puts its main action first: the Connect, Budget and Schedule cards also put their secondary button before the ghost ones. A Mac dialog puts the default button last, at the trailing edge. This is a product call because every card would change.

**Decided 10-17 (Q5): last.** Every Juno card ends with its default button: Dismiss · Apply, Skip · Connect, Wait until tomorrow · Allow, Delete · Pause · Keep, Dismiss · Start, Stop · Sign in. `ChatCard` puts its own Dismiss before the card's buttons. Remove already ended with Keep. `list-geometry.spec.ts` checks that the one filled button is last on seven cards.

- Compare: `compare/14-change-card-buttons-*`, and `after/14b-schedule-card-*`.

### 13. Smaller observations. Low. Three fixed, one open.

- **Avatar menu. Fixed.** Sign out was centred under the Session block (`before/AccountMenu-sections-with-session-light`). The session block is a column, and Sign out is pulled back by its padding and border so its text starts on the account line's edge, at the menu's inset. The gallery's account menu now uses the app's `SessionView` instead of its own copy. Compare: `compare/16-account-menu-*`.
- **Copy. Open (Q6).** General › AI assist says "Turn this off to use the decision chat model." This review suggested "Off uses your chat model for these decisions.", but that wording is wrong. With the classifier off, those decisions go to the `decision` model (`packages/ai/src/config.ts`, GPT-6 Luna by default), not the Chat model chosen in Settings › Juno, and the UI has no setting for the decision model. "Your chat model" would point people at the wrong setting. The copy is unchanged until the owner picks wording, for example "Off uses a small chat model for these decisions."
- **Configure sheet. Fixed.** Rows were 55.7px, and a row's rule sat on the list's bottom edge over the sheet's padding. Rows are now 56px (`--tool-row-height`: a 20px name line, a 16px description line, 8px above and below), and the list is seven rows tall. Each rule is drawn above its row, after the header's, so at rest the list ends on a row's edge with no rule. Compare: `compare/17-configure-*`.
- **Sidebar times. Fixed.** Times sat left-aligned in a 48px slot, so "Yesterday" ended 12px from the edge and "4m" about 40px away. The slot is now at least 48px and aligned to its end, so every time ends at the row's trailing inset. Compare: `compare/18-sidebar-times-*`.
- **Test drift, not a design defect.** `shift.spec.ts` › "a message's first chip grows it at its bottom" fails on `batch-3`. Main has replaced it with "uses its reserved line", which matches SPEC "Stable geometry" and the code, but `batch-3` still carries the older copy. It clears when `batch-3` takes main's version. The reserved line is also why a message with a thread link has a blank line above the link (`before/Message-interaction-hover-toolbar-main-light`), which SPEC asks for.

## Questions for the owner

Q1 to Q5 were decided on 10-17 with the suggested answers, as decisions the owner can override, and are built. Q6 is new.

| | Question | Answer |
| --- | --- | --- |
| Q1 | One row layout for Settings? | Trailing controls everywhere, as macOS does. Decided 10-17. |
| Q2 | Should tab Close buttons be Tab stops? | No. Delete and ⌘W close a focused tab; Close stays for the pointer and as VoiceOver's action. Decided 10-17. |
| Q3 | What height are two-line picker rows? | 44, with a fixed 20px title line and 16px meta line. Decided 10-17. |
| Q4 | Main's icon in the switcher? | Drop it. Decided 10-17. |
| Q5 | Default button first or last in Juno cards? | Last, as on the Mac. Decided 10-17. |
| Q6 | What should General › AI assist say about turning the classifier off? | Name what actually runs: "Off uses a small chat model for these decisions." Open. |

## Commits

| Commit | Change |
| --- | --- |
| `cc890f9c` | Start Settings rows 15px in on every section (finding 1) |
| `0914f192` | Open the topic switcher on the topic on screen (finding 2) |
| `8d6a62f4` | Give the gallery's topic header the switcher title the app uses (finding 5) |
| `2a187d36` | Set the card header's dot in the meta type (finding 4) |
| `a53ae2eb` | Raise muted text on a selected option row to 4.5:1 (finding 3) |
| `4c8d5b85` | Draw the gallery's topic switcher at the app's 300px (finding 6) |
| `85fe9e02` | Put Settings controls at the trailing edge, as System Settings (finding 7, Q1) |
| `b24e926a` | Take tab close buttons out of the Tab order and out of the tab (finding 8, Q2) |
| `8ee9213a` | Make two-line picker rows 44px: a 20px title over a 16px meta line (finding 9, Q3) |
| `e02c4f84` | Drop Main's icon in the thread lists so every title starts on one edge (finding 10, Q4) |
| `6500d11d` | Put each Juno card's default button last, at the trailing edge (finding 12, Q5) |
| `18086c25` | Show a saved key in Set up Juno as Settings does: a chip beside the field (finding 11) |
| `bca549ba` | Start Sign out on the account line's edge in the avatar menu (finding 13) |
| `511ee69b` | Put Configure's tool rows on the grid and its rules above them (finding 13) |
| `44505c1b` | End sidebar times at the row's trailing edge (finding 13) |
| `98d7c3a9` | Focus the active tab in the narrow strip's focus state (finding 8) |
| `2fca2337` | Split the tab strip from the tab, and the tab's parts into small components (lint's size limits) |

## Verification

- Gallery behaviour tests for the changed components, against this branch's build: `settings.spec.ts` (7 passed, including the new inset check), the new `list-geometry.spec.ts` checks (switcher, card header, selected row colour), and `shift.spec.ts` with `GALLERY_SHIFT_ONLY=TopicHeader,TopicSwitcher,SettingsPage,ChangeCard,ConnectCard,QuestionCard,SendMessageCard`. All passed except the `batch-3` test drift noted in finding 13, which does not touch these components.
- `pnpm remote test:desktop e2e/topic.spec.ts`: 13 passed, including the switcher's new keyboard steps.
- `pnpm affected` (before the last commit): typecheck, test, specs:check, test:health and test:remote-pool passed. Lint failed on two health regressions from this branch's tests (`geometry.spec.ts` over 400 lines, the Settings `describe` over 80 lines). The last commit moves the new checks to `list-geometry.spec.ts` and out of the `describe`, and `pnpm lint` now passes. test:gallery failed only on the test drift in finding 13. test:desktop failed nine tests that do not reach this branch's changes. They come from other batch-3 work: `sidebar.spec.ts` (participant stacks, the first-sync list), `layout-shift.spec.ts` (cold sync, and a `Threads` header button that the header no longer has), `juno-agent/set-up.spec.ts` (Home's Ask Juno) and `juno-agent/source-link.spec.ts`. They were not rerun on `batch-3` alone.

Second round (10-17, the decisions):

- `pnpm lint` passes. Typecheck passes for `@juno/tokens`, `@juno/ui`, `@juno/views` and `@juno/gallery`, and for the desktop renderer and e2e configs.
- Gallery behaviour suite (`behaviour.spec.ts`, every `*geometry.spec.ts`, `settings.spec.ts`, and `shift.spec.ts` for the 25 touched components): 134 passed, 1 failed, the `batch-3` test drift in finding 13.
- `pnpm remote test:desktop e2e/tabs.spec.ts e2e/topic.spec.ts e2e/juno-agent/cards.spec.ts`: all four shards exited 0. Two shards' reports did not download; the two that did show 27 passed.
- Light and dark shots were retaken for every touched component. Contrast stays at or above 4.5:1 on them, apart from the sidebar's avatar initials, which predate this review.
