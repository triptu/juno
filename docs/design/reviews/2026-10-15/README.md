# Design review, 2026-10-15: the surfaces that landed today

Reviewed against `docs/design/handoff/SPEC.md` (sections 7, 9, 11 to 14, 16 and 17), `docs/design/inventory.md`, `tokens.md` and `primitives.md`, using the `interfaces:better-interface` review (accessibility, layout, writing, typography, colour, UI polish) and the feel review. Code was read at `7c556f19` (main). The fixes are on `design-review-1015`.

## Scope and how it was checked

- **Surfaces.** The floating header (B) on a thread, Main and a DM; New chat (empty, picker, thread picked); Home; All topics (full and empty); peek; Resolve with its toast, rename in the header; the M6 composer, hover toolbar, emoji picker, edit in place and delete confirm; the account menu, Notifications, Preferences and the why popover; custom sidebar views (the sheet and the pills); the Juno tab, the Juno panel, the Juno header menu, Settings › Juno, Activity, What Juno remembers, Memory of this chat, Scheduled, Connections, the paused banner; "Juno needs a model" and "Add a provider" with its error.
- **The app.** `harness/review.spec.ts` drives the built app against the fake Slack (and the fake OpenRouter for Juno) at 1400 × 900, plus 720 × 600 and 900 × 700, and shoots each surface in light and dark. It also records element boxes and styles (`harness/out-*/measure-*.json`), a Tab walk with each stop's name and ring (`tab-*.json`) and every text node's contrast against what is painted behind it (`contrast-*.json`). The shots were then shrunk to 1400px JPEGs with ffmpeg. The harness was removed on 10-25; `git show 1e776b39c:docs/design/reviews/2026-10-15/harness/review.spec.ts` has it.
- **Gallery.** `GALLERY_SHOTS_ONLY=…` for the 24 new or changed view components (247 states, light and dark), read for the states the app did not reach (Codex, banners, provider errors, toasts).
- **Feel.** `pnpm test:feel` on the Mac (below).
- **Files.** `before/` and `after/` hold the same shot names; `compare/` stacks before over after for each fix; `feel/` holds the frames the feel finding cites.
- **Not reviewed.** Native context menus (they are macOS menus; only their labels were read). 200% zoom and right-to-left text in the new surfaces. The Notifications and Preferences pages below the fold (the harness scrolled the wrong element). VoiceOver itself; names and roles were read from the DOM.

What held up: every Tab stop on the topic, the Juno tab and the panel has a name and a 2px `--focus-ring` outline; the hover toolbar shows on keyboard focus; no text pair on the measured screens is under 4.5:1 except the one fixed below; light and dark agree everywhere; empty states (All topics, Scheduled, What Juno remembers, Connections) say what the place is and offer one next step; the header islands sit at the same 8px top and 36px height on the topic, the Juno tab and the panel.

## Findings, worst first

Each finding names the surface, the evidence and the state after this branch.

### 1. In a narrow column the sender's name disappears. Fixed.

At a 720px window the topic column is about 260px wide. Every message header kept the hover toolbar's 243px (`--toolbar-reserve`) free at its end, so the name shrank to nothing and only the time was left: "L · 14:06". It hid who wrote every message, in threads and Main. Evidence: `compare/16-topic-720-*.jpg`, `compare/16b-main-720-*.jpg`. Source: `packages/views/src/Message.tsx` (`headerWithToolbar`).

Fix: the reserve gives way below a 160px floor for the name and time (`min(reserve, max(0px, 100% − 160px))`). In a narrow column the toolbar now covers the end of the name while the row is hovered, which is the better loss.

### 2. A reaction on the last message pushes the list off the bottom. Fixed after the review (feel).

`reaction-at-bottom` fails "stays at the bottom": from frame #5 the list is off the bottom on 38 of 39 frames, by up to 30px, and it never comes back. In the last frame (#42) the new reaction chip is cut off under the composer. The user reading at the bottom has to scroll to see it. Evidence: `feel/reaction-at-bottom-0001.jpg` and `-0042.jpg`, `feel/reaction-at-bottom-filmstrip.png`. The bottom pin in the topic view does not follow a row that grows in place. This is scroll code in the container, which the perf and flake work owns, so it is reported here and not changed.

Fixed by 9cb45ce3 (the bottom is held again whenever the window's rows change, not only when a new last message arrives), which reached main after this review. The scenario now posts enough replies that the list scrolls, since in a list that fits, staying at the bottom proves nothing; on this review's code it fails (6 of 6 frames off the bottom, by up to 20px), and on main it passed 5 of 5 runs on the Mac.

### 3. The field focus ring was heavy, and doubled. Fixed.

Every field (both composers, text fields, the card textarea) drew a 1px `--focus-ring` border plus a 1px ring of the same colour: 2px of accent around a pill. The Juno panel opens with its composer focused, so that band is always on screen there; the Juno tab and New chat look the same. When keyboard focus moved to Send, the field's ring and the button's 2px outline showed together. Evidence: `compare/44b-panel-composer-focus-crop-*.jpg`, `before/06b-composer-keyboard-focus-*.jpg`. Source: `packages/ui/src/Surface.tsx` (`field`), `TextField.tsx`, `Textarea.tsx`.

Fix: the border alone turns `--focus-ring` (#B4351F, 4.5:1 or better on the page). The ring is gone, so the Send case is now a 1px border plus the button's own outline. `primitives.md` updated.

### 4. The topic composer and the Juno composer were built two ways. Fixed.

Measured at 1400 × 900:

| | Topic | Juno tab | Juno panel |
| --- | --- | --- | --- |
| Height | 40 | 42 | 42 |
| Send arrow | 16 | 18 | 18 |
| Left edge vs its header island | 516 / 516 | 556 / 564 | 1053 / 1053 |
| Bottom edge | 813 | 813 | 821 |

The Juno tab's field started 8px left of its island and of the chat column, and beside a topic the panel's field ended 8px below the topic's. Evidence: `compare/41-juno-tab-chat-*.jpg`, `compare/44-panel-composer-focus-*.jpg`, `harness/out-*/measure-*composer*.json`. Source: `packages/views/src/juno-chat/JunoComposer.tsx`.

Fix: the Juno field is 40px (its row reaches into the 1px border, as the topic composer's does), uses the 16px arrow, is 656px wide (the 720 column less 32 each side) so it starts at 564 with the island and the bubbles, and the panel keeps the topic's 20px bottom inset. After: all three fields are 40px tall and end on one line. `inventory.md` §12 updated.

### 5. Messages have two rhythms. Question for the owner (Q1).

In a topic tab the header line of every message is at least 34px tall (`headerWithToolbar`'s `minHeight`, so the toolbar never covers the first body line). The same `Message` in peek and in the New chat preview has no toolbar, so its header is about 20px. The gap from name to body is about 14px larger in topics than anywhere else; compare `before/02-topic-thread-*.jpg` with `before/17-peek-*.jpg` and `before/20-new-chat-thread-picked-*.jpg`.

### 6. Pages use four widths and two title sizes. Question for the owner (Q2).

Title left edges at 1400 × 900: Notifications 479 (`wide`, 880), Preferences and Settings › Juno 544 (`settings`, 760), the Juno pages 564 (`default`, 720), All topics its own layout with a 32px title at y 76 instead of 34px at y 84. Opening Notifications, then Preferences, then Settings › Juno, the title jumps on each. `tokens.md` documents the widths, so this is a choice, but the three settings-like pages should share one.

Settings › Juno also moved its column 5px left when the agent's sections arrived and the page began to scroll (544 → 539). **Fixed:** `Page` keeps a stable scrollbar gutter, as `ScrollArea` does. Evidence: `compare/31-settings-juno-add-provider-*.jpg`, `harness/out-after/measure-provider.json`.

### 7. Preferences laid out its rows two ways. Fixed.

Theme, Accent and Density put the label beside the control; Hold to peek put it above. The controls did not share an edge. Fix: one row layout with a shared `--settings-label-width` (104px, new layout token) so "Hold to peek" fits on one line. Evidence: `compare/25-preferences-*.jpg`.

### 8. Settings › Juno copy. Fixed.

- The model picker read "Claude Sonnet · Claude Sonnet 5.5 · $2 / $10 per million tokens" (and "GPT Sol · GPT-6.1 Sol"). It now shows the model's own name: "Claude Sonnet 5.5 · $2 / $10 per million tokens".
- The daily cap field showed "2". It now shows "$ 2"; the field's name stays "Daily cap in dollars".
- The Codex section (gallery only, not wired yet) had a heading "Codex" over a row titled "Codex". The row now reads "Uses your ChatGPT plan on this Mac."

Evidence: `compare/46-settings-juno-*.jpg`, `harness/out-after/settings-model-options.json`. Source: `packages/views/src/juno-pages/JunoSettingsPage.tsx`.

Not changed: "$2 / $10 per million tokens" does not say which is input and which is output. See Q6.

### 9. The Juno chat counts its own replies as new while you read them. Not verified.

With the Juno tab open, Juno's two replies arrived under a "2 new" divider and the sidebar's Juno item showed "2"; the panel did the same with "1 new" (`before/41-juno-tab-chat-*.jpg`, `before/45-panel-chat-*.jpg`). A topic open on screen marks read at once. The Playwright window may not count as focused, so check this by hand before treating it as a bug.

### 10. Small labels mix uppercase and sentence case. Question (Q3).

"TODAY", "2 NEW", "CHANNELS", "SESSION", "DIAGNOSTICS" and the All topics column heads are uppercase, while the emoji picker's group labels ("Frequently used", "Smileys & emotion") are sentence case. SPEC §17 says sentence case everywhere.

### 11. Controls that are not controls, and clutter. Questions (Q4, Q5).

- Every composer starts with a round "+" (`Composer.tsx` `attach`) drawn like a button. It is `aria-hidden` and does nothing until attachments ship.
- Activity shows each run as a header line plus a card that says only "No actions" (`before/47-page-activity-*.jpg`). Three runs are three identical cards.

### 12. Low.

- **Delete confirm.** Delete takes the accent fill (the same coral as Send), and its "↵" hint is faint on that fill (`before/11-message-delete-confirm-*.jpg`). Cancel has no Esc hint. Consider dropping the hint; a destructive colour is a product choice (no `danger` button exists).
- **All topics counts.** The muted count on the selected chip measured 4.4:1. **Fixed:** the counts use the subtle tone.
- **The view sheet** has no title and its Name field is known only by its placeholder (`before/27-view-sheet-*.jpg`). It has an accessible name; sighted users see "Name" vanish once they type.
- **Provider key.** With a key set, "Key set" sits beside an empty field whose placeholder is "sk-or-…", which reads as if the key is missing. A placeholder such as "Paste a new key" would say what the field is for.
- **Settings source.** The Backup section's JSX in `JunoSettingsPage.tsx` is mis-indented (a `)}` on its own line mid-text). It renders correctly.

## Questions for the owner

Each has a recommendation. They are left open because each changes what a surface looks like or what it offers.

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Should topic messages keep the taller header line that clears the toolbar, or match peek and New chat? | Match them: drop the 34px `minHeight` and let the toolbar cover the end of the first body line on hover, as Slack's does. One rhythm everywhere, and it removes a rule instead of adding one. |
| Q2 | One width for Notifications, Preferences and Settings › Juno? | Use `settings` (760) for all three and let the Notifications hours row wrap its day buttons under the label at that width. Keep `default` for the Juno pages and All topics' own layout. |
| Q3 | Uppercase small labels or sentence case? | Sentence case, per SPEC §17, at the same size and weight, with no letter-spacing. Start with the day separator and the "N new" divider, which the eye meets most. |
| Q4 | Keep the "+" in the composer before attachments exist? | Remove it until attachments ship. It looks like a button and does nothing. |
| Q5 | Should Activity show a card for a run with no actions? | No. Show the run's line ("You · 14:18 · Replied") and add a card only when there are actions to list. |
| Q6 | How should the model price read? | "$2 in, $10 out per million tokens", or move the price into the picker's option text only and keep the closed select to the model name. |

## Feel review

Run at `7c556f19` on 2026-10-15, about 2.1 minutes for 8 tests and 19 scenarios, load average 5 to 8.5 on the Mac. 6 tests passed, 2 failed.

| What a person sees | Scenario | Frames | Check | Likely cause |
| --- | --- | --- | --- | --- |
| A reaction on the last message pushes the list off the bottom, and the chip ends up under the composer | `reaction-at-bottom` | #5 to #16, still off at #42 | stays at the bottom | The bottom pin does not follow a row that grows in place (finding 2) |
| The test never reached its recording: after opening `#perf-main` in a new tab the list was 7,970px from the bottom with "Jump to latest" showing | `tabs.feel.ts` (switching back to a scrolled tab) | none | precondition (`expectAtBottom`) | Suite problem: `#perf-main` has never been read, so it opens at its "N new" divider, about 8,000px up, as designed. 7aae965e (after this review) makes the setup jump to the latest; with that, this review's app code passes, and main passed 5 of 5 runs |
| Your own bubble moves down 46px as Juno's first reply arrives | `juno-first-bubble` | warn | no layout shift (0.0027) | The reply's row is laid out above the owner's bubble's final place; small, seen once |
| A sidebar row moves when a reply arrives elsewhere | `live-reply-at-bottom` | warn | the sidebar holds still (0.005) | The row moves to the top, as designed; the warning is expected |

Every other scenario passed, including hover and press feedback, popovers opening whole at their anchor, the Juno tab and panel opening, and the long thread with late images.

Missing scenarios for today's surfaces, to add under `apps/desktop/e2e/feel/`:

- Emoji picker: open from More reactions; check it opens whole at its anchor and nothing under it moves.
- Toast: Resolve from the header; check the toast lands and stays, and the list and sidebar do not shift when it arrives and leaves.
- New chat to topic: send from a New chat; check the composer field does not move and the pane switches once.
- Peek: hold ⌥ over a row; check the popover opens whole in its first frame and switches once between rows.
- Settings › Juno: save a key; check no layout shift when the agent's Model and Spend sections arrive.
- Delete confirm: press Delete on your own message; check the toolbar swaps to the confirm in one frame with no shift.

## Commits on `design-review-1015`

- `1f20a236` Keep the sender's name in narrow message columns
- `5217bcf0` Show field focus with the border alone
- `5611e5c2` Tidy Settings › Juno labels
- `18824875` Line the Juno composer up with the topic composer
- `01faec71` Lay out Hold to peek like the Appearance rows
- `fb324fec` Raise the All topics chip counts to the subtle tone
- `cec1fd3e` Keep the page column still when a page starts to scroll
- This review (the document, the harness, the shots).

## Verification

- `pnpm affected` after the first six fixes: typecheck, lint, `test:gallery` and `test:desktop` passed (119 passed, 24 skipped). Run again after the Page fix and after merging main (`bd46339d`): all four passed.
- `pnpm build` passed after each fix; the bundle stays under budget.
- The after shots were taken with the same harness, and the numbers in findings 3, 4 and 6 come from `harness/out-after/`.
- Not verified: finding 9 in a focused window; the `tabs.feel.ts` scenario, whose precondition failed.

## Verdict

Approve for the inspected surfaces once finding 2 is fixed. Findings 1, 3, 4, 7 and 8 are fixed here; 2 needs the scroll owner; Q1 to Q6 need the owner. Not reviewed: native menus, 200% zoom and right-to-left text in the new surfaces, and the lower part of Notifications and Preferences.
