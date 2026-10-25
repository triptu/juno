# Design review, 2026-10-16: the surfaces that landed on 10-15

Six surfaces built on 10-15 without a design pass, reviewed against `docs/design/handoff/SPEC.md` (sections 5, 8, 10, 13 and 17), `inventory.md`, `tokens.md` and `primitives.md`, with the method of `../2026-10-15/`. Code was read at `b218096a` (main, attachments polish included). The fixes are on `design-review-1016`.

## Scope and how it was checked

- **Surfaces.**
  1. ⌘K: recent, results, people, a command, no matches, overflowing, the key hints, open and close.
  2. Automated: the sidebar pill, the view sheet's "Added by Juno" rows, and the Home question "Move #releases to Automated?" with Keep in All and Move.
  3. Settings › Juno: Backup, This Mac, the recovery phrase, Restore and Move sheets, the Review page, and the other-Mac banner chip.
  4. Connections: the three presets, tool tiers, and Add a server.
  5. Privacy mode: the account menu item and the sidebar footer.
  6. The composer's audience line and send-check bar, with its confidence.
- **The app.** `harness/review.spec.ts` drives the built app against the fake Slack (and the fake model for the Juno pages) at 1400 × 900 and 720 × 600. It shoots each state in light and dark. It also records element boxes (`harness/out-*/measure-*.json`), Tab walks (`tab-*.json`), where focus lands after a close (`focus-*.json`), the palette's animations with and without reduced motion, and every text node's contrast against what is painted behind it (`contrast-*.json`). `before` was run from a clean checkout of `b218096a`, `after` from this branch. The harness was removed on 10-25; `git show 1e776b39c:docs/design/reviews/2026-10-16/harness/review.spec.ts` has it.
- **Gallery.** `gallery:shots` for the 16 views involved, from main and from this branch, plus measurements taken in the gallery in a browser. The 720 × 600 window gives the topic composer a 288px field. The gallery's `Composer` › Checks › `narrow-*` states draw it at 336px.
- **Files.** `before/` and `after/` hold the app shots, `gallery/before|after/` the gallery shots this document cites, and `compare/` stacks before over after for each fix.
- **Not reviewed.** VoiceOver itself: names and roles were read from the DOM. Native context menus (the Automated item's channel menu). 200% zoom and right-to-left text. The palette's Slack-search rows, which the fake Slack does not return for these queries. `pnpm test:feel` was not run (see Verification).

What held up:

- Contrast. No text on the measured screens is under 4.5:1 in either theme. The only pairs under it are disabled buttons (Restore, Add, Save at 40% opacity), which are exempt.
- The palette is symmetric: the field, the esc keycap and the rows sit 16px in from the panel on both sides (`geometry.spec.ts` already holds the rows).
- The privacy footer measures 10/10/10 with Show 4px from its edges, as the inventory says.
- The view sheet's "Added by Juno" rows keep the 8px row insets at both ends.
- The This Mac chip ends with the text buttons below it (the attachments polish).
- The palette has no open or close animation, so reduced motion has nothing to remove (`palette-open-animations*.json` are empty). It opens whole in its first frame, as Spotlight does.
- Every Tab stop measured shows the 2px `--focus-ring` outline.

## Findings, worst first

Severity: **high** breaks the surface or traps the keyboard user; **medium** is a visible defect under the existing rules; **low** is polish.

### 1. In a narrow composer the send-check bar printed its finding one word per line. High. Fixed.

At a 720px window the topic composer is 288px wide. The bar gave the finding no minimum width, so the text shrank to zero and wrapped a word per line, 240px tall. Its last word printed over the confidence number. Every narrow window and every topic beside an open Juno panel shows this.

- Evidence: `before/21-clarity-bar-720-*.jpg`, `before/22-route-bar-720-*.jpg`, `gallery/before/Composer-checks-narrow-*`.
- Source: `packages/views/src/SendCheckBar.tsx`.

**Fix.** The finding keeps at least 200px (`min(200px, 100%)`, a named constant). When the choices do not fit beside it, the confidence and both buttons move to a line of their own, at the end. The bar's 8px insets hold at the end and at the bottom. At full width nothing moves, except that the gap between the three choices is now 8px instead of 10, so that the narrow route bar ("Post in thread", "Send to Main") fits in 336px.

- Gallery states: `Composer` › Checks › `narrow-audience-and-check` and `narrow-wrong-place`.
- `geometry.spec.ts` holds the 200px, the second line and the insets.
- Compare: `compare/01-check-bar-narrow-*`, `01b-route-bar-narrow-*`, `01c-clarity-bar-app-720-*`.

### 2. Tab left the ⌘K palette for the window under it. High (keyboard). Fixed.

The palette is a modal dialog (`aria-modal`), but Tab from its field moved focus to Hide sidebar, Search and New chat in the title bar under the dim while the palette stayed open (`harness/out-before/tab-palette.json`). Spotlight keeps the keyboard in its field.

**Fix.** The field is the palette's only stop. Tab and Shift Tab stay in it (`out-after/tab-palette.json`). `e2e/palette.spec.ts` checks both.

### 3. Tab left the Backup sheets, and closing one focused nothing. High (keyboard). Fixed.

The recovery phrase, Restore and Move sheets are modal, but Tab went from their buttons to the sidebar under the dim (`out-before/tab-31-phrase-sheet.json`, `tab-33-move-sheet.json`). Escape or Cancel left focus on the page body (`out-before/focus-after-3*.json`), so a keyboard user started again from the top of the window.

**Fix.** `SheetLayer` keeps Tab and Shift Tab going round the sheet's controls. It reads what had focus on its first render and gives focus back to it on close. It must be read on the first render: an effect runs after the sheet's own autofocused button has taken focus, which was the first attempt's bug. After the fix, focus returns to Restore and Move (`out-after/focus-after-32-*`, `-33-*`), and the walks stay in the sheet (`out-after/tab-3*.json`). `e2e/juno-agent/backup.spec.ts` checks the Tab loop and the return.

`SheetLayer` also hosts the Juno chat's Remove sheet, which gets the same behaviour.

Two limits:

- A mouse click on macOS does not focus a button, so a sheet opened by a click has no opener to return to. Focus stays where it was, as in a native app.
- The recovery phrase sheet opens after the export finishes, and Export recovery phrase is disabled while the export runs, so it has already lost focus when the sheet opens. Closing that sheet still focuses the page body. Keeping the button enabled (and ignoring a second press) would fix it. That is the container's call, so it is left as is.

### 4. The palette's key hints had two looks. Medium. Fixed.

On a topic or Main row the active hint was a keycap and a word: "⌘↵" then "New tab". On a command it was bare mono text, "↵ Send". On a person with no DM it was a bare "↵". All three can be on screen within a few keystrokes.

- Evidence: `gallery/before/CommandPalette-states-command-*`, `before/04-palette-command-*`.

**Fix.** Every hint is a keycap for the keys, then the action in 12px muted text. A bare "↵" stays a keycap alone. The domain's hint strings ("↵ Send", "↵ Resolve") are unchanged; the view splits the keys from the word. `inventory.md` §9 is updated.

- Compare: `compare/02-palette-command-hint-*`.

### 5. A server card with no tools drew a line over its bottom edge. Medium. Fixed.

A server's first row kept its row divider when no row followed it. On a new install that is all three presets (Notion, Littlebird, T3 Code), each with a hairline 1px above the card's bottom edge.

- Evidence: `before/42-connections-720-*`, `gallery/before/ConnectionsPage-connections-servers-*` (Littlebird).
- Source: `packages/views/src/juno-pages/ConnectionsPage.tsx`.

**Fix.** The row draws a divider only when the T3 address row or a tool follows it. `geometry.spec.ts` checks every card's last row.

- Compare: `compare/04-connections-*`, `04c-connections-app-720-*`.

### 6. Add a server put its button at the start. Low. Fixed.

Every other action on the page ends at the card's trailing 15px inset: Connect, Sign in, Disconnect, and the fields above. Add sat at the leading edge under the fields, with the refusal after it.

**Fix.** Add ends at the trailing inset, level with the fields, and a refusal reads before it from the leading inset. `geometry.spec.ts` holds both edges.

- Compare: `compare/04b-add-a-server-*`.

### 7. Restore's folder box did not match the field under it. Low. Fixed.

The folder box and the recovery phrase field are stacked one above the other, but were drawn two ways: radius 8 against 7, a `--border-default` border against `--input-border`, a different fill, and text 13px in against 11px in.

**Fix.** The folder box is drawn as the 32px text field: the same radius, border and fill, and its text starts on the field text's line. Choose folder sits 5px from the box's end, top and bottom. `geometry.spec.ts` checks all of these.

- Compare: `compare/03-restore-folder-*`.

### 8. "Finish signing in in your browser." Low (copy, §17). Fixed.

It now reads "Your browser is open to finish signing in." (`chatCopy.pages.connections.signingIn`).

### 9. The send-check confidence has no name. Low (accessibility). Question Q1.

"98%" sits beside the buttons with no label. VoiceOver reads "98 percent" with nothing to say what it measures. In the palette, the same number is a chip whose title is "Juno's read of what you typed". This is left open because the answer may be to remove the number.

### 10. Connections says a tool's tier three times. Question Q2.

A tool row shows a chip ("Read" filled, or "Asks every time" outlined), a second chip ("Default", quiet), and a checkbox "Needs no click" (`gallery/before/ConnectionsPage-connections-servers-*`). The chip and the checkbox say the same thing in different words ("Read" against "Needs no click"). That makes three chip looks on one line.

### 11. Every preset that is off shows a coral Connect. Question Q3.

On a new install the page has three accent-filled buttons, one per card (`before/42-connections-720-*`). A Mac settings pane has at most one default button. The other server buttons (Disconnect, Remove, Add) are secondary or ghost.

### 12. Smaller observations. Low. Not changed.

- **Backup folder path.** The path is cut at its end ("…/agent/b…"), which hides the folder's own name (`before/30-settings-backup-*`). macOS cuts paths in the middle. That needs a measured truncation, so see Q4.
- **Home's Automated question.** Keep in All and Move are both muted ghost buttons, so the question's two answers have equal weight. A long channel name truncates the title and cuts "to Automated?" off (the row has 190px for it at Home's width). See Q5.
- **Palette placeholder.** "Search, or tell Juno: message maya the slot works" shows a lowercase name and is long for a field. See Q6.
- **Privacy footer.** Show is a pill (radius 11) inside a radius-8 strip, so the curves are not concentric. The inventory asks for the raised xs button, so this is as specified.
- **Sheets borrow palette tokens.** `SheetLayer` uses `--z-palette` and the sheet uses `--palette-width` (560). They render correctly. A `--sheet-width` would say what it is if a second sheet size ever appears.

## Questions for the owner

Each has a recommendation. They are left open because each changes what a surface offers or how it reads.

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Should the send-check bar keep its confidence number? | Remove it from the bar. The choices already say what the check thinks, and a number with no name reads as noise. Keep it in the palette, where it is a titled chip. If it stays, give it a name: "98% sure" as text, which VoiceOver reads too. |
| Q2 | How should a tool's tier read on Connections? | Keep the checkbox alone, renamed to the tier ("Runs without asking"), and drop the Read and Asks every time chips. Keep "Default" as quiet text only where the owner changed a default. |
| Q3 | Should an off preset show an accent Connect? | Use secondary for Connect and Sign in, and keep the accent for nothing on this page. A connection is a deliberate choice, not the page's next step. |
| Q4 | How should the backup folder read? | Show the folder's name with its place ("Juno backup · Dropbox") and the full path as the title, or cut the path in the middle as Finder does. |
| Q5 | Should Move be the stronger answer on Home's Automated question? | Yes: Move as the raised button and Keep in All as ghost, in that order (Keep in All, then Move). Shorten the title to "Move #releases?" and put "To Automated" first in the meta line, so a long name never cuts the question. |
| Q6 | Palette placeholder? | "Search, or ask Juno". The example teaches commands once, but every open shows it. |

## Commits on `design-review-1016`

- `cafc4257` Let the send check bar wrap its choices in a narrow composer (finding 1)
- `8f12b0f2` Keep Tab in the command palette and draw every key hint one way (2, 4)
- `df6f7c00` Hold the keyboard in the Backup sheets and match the folder box to its field (3, 7)
- `36585d6d` End the Add a server form with its button, and fix the sign-in line (6, 8; it also carries the Restore folder geometry check)
- `477a8b93` Drop the divider under a server card's only row (5)
- `8e59219e` Give focus back to a sheet's opener, read before the sheet autofocuses (3)
- This review (the document, the harness, the shots).

## Verification

- `pnpm --filter @juno/views typecheck` after each change, and `pnpm build`: the bundle stays under budget (JS 935.5 KB, CSS 117.3 KB).
- Locally under the heavy lock, after the last fix: `e2e/palette.spec.ts` (10 passed) and `e2e/juno-agent/backup.spec.ts` (passed).
- The geometry checks were measured in the gallery while being written.
- `pnpm affected` after merging origin/main: typecheck, lint, `pnpm test`, `test:gallery` and `test:desktop` (207 passed) all passed. An earlier run before the merge passed everything but `test:desktop`, which never started because Namespace could not create a machine.
- The harness ran twice, before (clean `b218096a`) and after (this branch). The numbers in findings 1 to 3 come from its `out-*` files.
- Not run: `pnpm test:feel`. The heavy lock was held by another worktree's exclusive perf runs for most of this review. None of these changes touch a list, a scroll path or an animation.

## Owner decisions implemented on `design-1016-2`

Q1–Q6 are resolved. The send-check percentage is removed. Connections has one
"Runs without asking" checkbox per tool, quiet Default text only for an overridden
allowlisted tool, and secondary Connect and Sign in buttons. Home asks
"Move #releases?" above "To Automated", with raised Move after quiet Keep in All.
Backup paths are measured and cut in the middle, with the full path in the hover
title. The palette reads "Search, or ask Juno".

The recovery export focus fix was small enough to include: Export recovery phrase
remains focusable while busy and ignores another press. The backup e2e flow opens
it with Enter and checks that closing the phrase sheet returns focus to Export.

The geometry tests hold the Connections and Backup row insets at 15px on both
sides, the Home title and meta alignment and equal vertical button insets, and the
narrow send-check bar's existing 8px end and bottom insets. The long-path case checks
that the folder name survives, the full path remains in the title, and the result
fits its measured width.

Selected light and dark gallery captures are in `gallery/decisions/`:

- `Composer-checks-narrow-audience-and-check-{light,dark}.png`
- `Composer-checks-narrow-wrong-place-{light,dark}.png`
- `ConnectionsPage-connections-servers-{light,dark}.png`
- `ConnectionsPage-connections-off-{light,dark}.png`
- `BackupSection-backup-long-path-{light,dark}.png`
- `CommandPalette-states-recent-{light,dark}.png`
- `Home-items-automated-{light,dark}.png` (hovered so both actions show)

All these pairs were inspected. The full generated set is in
`apps/gallery/shots/{SendCheckBar,Composer,ConnectionsPage,Home,BackupSection,JunoSettingsPage,CommandPalette}/`.
They were generated through `pnpm gallery:shots`, with `GALLERY_SHOTS_ONLY` set to
those components; Home was captured again with its action row hovered.

After merging origin/main (`82778e3b`), `pnpm affected` passed typecheck, lint,
unit tests, 115 gallery tests and 217 desktop e2e tests (47 existing skips).
The health ratchet passed with no new unused exports or oversized functions.
The first runs found three old-copy assertions and a path fixture too short to
truncate; those were corrected before this pass. No perf or feel run was added
for these copy and control changes.
