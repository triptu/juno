# Home merged with New chat, round 3

The owner picked round 2's Address book and its composer (the destination chip, and `@` or `#` with Tab or Space). He asked for it calmer:

- No `@` and `#` keycaps.
- No times on recents.
- No "N things want you" line.
- The composer stays exactly as it is.

This round strips the address book to what helps you pick a destination, tries four arrangements, and refines one.

Code: `packages/views/src/HomeQuiet.tsx`, with fixtures `HomeQuiet.fixtures.tsx` (gallery `HomeQuiet1` to `HomeQuiet4`, and `HomeQuietRefined`). The composer is round 2's `HomeComposer`, unchanged. The data is in `fixtures/recents.ts`.

## What every variant shares

- **No greeting while something waits.** The rows are the news, and you can count them. Caught up, the scene and "All caught up." remain: it is the only thing to say, and it tells you the empty page is not broken. There is no line under it.
- **What needs you reads apart from recents by size alone.** Needs you rows are two lines, 52px, with the topic's 40px art and a medium title. Recents are one line, 32px, with a 20px face or channel art and a regular name. There is no label, divider or count. One 32px gap separates the groups; inside a group the gap is 2px (better-layout: group with space, the gap between groups at least twice the gap within).
- **One column, Home's own.** It is 480px, centred, and starts from the top when the window is short. The composer stays pinned at the bottom.
- **One edge for names.** A recent's 20px mark sits on the axis of a Needs you row's 40px art, and its name starts on the same edge as the Needs you titles.

## Four variants

Contact sheets of the five states (`items-waiting`, `caught-up`, `at-person`, `writing`, `narrow`), light and dark: `explore/<letter>-<name>-{light,dark}.jpg`. The full-size shots are in `apps/gallery/shots/HomeQuiet<n>/states/`, which is not committed.

- **A · Two compact columns, no labels.** People on the left, channels on the right, five each. Faces against channel art make the split without a header. The calmest that still scans: you look left for a person and right for a channel.
- **B · One list.** People and channels together, newest first. One column is simple, but faces and tiles alternate, so the eye has no rhythm, and you cannot go straight to "a channel" or "a person".
- **C · Pills.** Ten filled pills that wrap. Compact, but ten fills read as tags or filters, the ragged right edge breaks the column, and the fills are louder than the Needs you rows they sit under.
- **D · Names only.** Names set as a short run of words, channels with their #. The most minimal, but the names look like text, not controls (better-layout: keep controls distinct from content). With no faces or art, finding a person is reading, not recognising.

## Refined: A · Two compact columns

Shots, light and dark: `refined/<state>-{light,dark}.png`. The states are `items-waiting`, `caught-up`, `at-person`, `at-channel`, `juno-hash`, `writing`, `first-run`, `narrow` (560) and `tiny` (400).

What changed from the A above:

- **Private channels keep their lock.** It is a 12px muted lock after the name, which is all that marks a private channel here (SPEC principle 4: always know where you are posting).
- **Recents are in the subtle tone at rest,** turning default on hover and when chosen. They sit below what needs you in the hierarchy without being smaller or fainter than they need to be.
- **One column when it is narrow.** Below 400px of column the two lists stack, people first, rather than cutting names short (`tiny`). At 560 (`narrow`) the two columns still fit whole names.
- **When a recent is chosen** its row takes the destination's tint, the same tint as the chip on the composer, so the choice shows in both places (`writing`).

Unchanged on purpose: no labels, no counts, no times, no greeting while items wait, and round 2's composer, chip, "Send to" list and keys.

## Recommendation: the refined A

- **It is the fewest elements that still answer "who can I write to".** Ten named destinations, split by kind with no header. A face or a channel's art is the label.
- **Recognition, not reading.** Faces and channel art are scanned faster than names alone (D), and the split lets you skip half the list (B).
- **Discipline.** One column width, one name edge, two row heights, two gaps. Needs you and recents differ by size and weight, not by chrome.
- **Calm across states.** Caught up, the rows give way to the scene and the title, and the columns stay where they are relative to them. The composer never moves.

## Final removal plan (replaces round 1's)

**What Home becomes** (SPEC §12, to be rewritten):

- What needs you, the caught-up scene, the recents in two columns, and one composer at the bottom with the destination chip.
- The composer replaces both Ask Juno and New chat's composer.
- Juno is the default destination. The first `@` or `#` suggests a person or channel: Tab or Enter picks, Space or Esc keeps the text.
- Backspace in an empty field returns to Juno. The chip opens the full conversation list with search.
- Recents use New chat's Frequent ranking (`domain/frequent.ts`), split into people (DMs and group DMs) and channels, five of each. Archived channels are left out.
- A send to a channel or a DM goes to its Main. A send to a channel's Main starts a thread rooted at the message, as New chat does today (§9). It appears in the sidebar as a followed topic, and Home stays.
- Home has no thread picker. To reply in an existing thread, open it.
- After a send to a person or channel, the composer stays in place, empty, and the destination returns to Juno. The usual toast says "Sent to Maya Chen" with Open.
- A send to Juno opens the Juno chat in the tab, and Back returns to Home. The Juno tab's field should take the topic composer's width (752px, against 656px today) so the field does not move.
- The send checks run as in New chat: the wrong-place check in a channel's Main, and the audience check on the chosen channel.
- Home's draft (text, destination, files) is saved with the tab and survives a restart. A Home tab with a draft never closes by itself; closing it shows "Draft closed · Undo".

**Removed:**

- The sidebar title bar's New chat button (`NotePencil` IconButton, `onNewChat` in `Sidebar.tsx` and its container).
- Settings › General › Tabs "New tabs open": `NewTabSetting`, `state/newTabPage.ts` and the `newTabPage` preference. "Close tabs not viewed in" stays.
- New chat as a page and a tab type: the `newChat` place in `state/tabs.ts`, `containers/NewChat.tsx`, `views/NewChat.tsx` and its fixtures, the New chat tab icon and title rule, the preview, `FrequentConversations` and `FrequentRows`, and the thread picker.
- `DestinationPickers`' conversation list stays as the chip's popover.
- Home's Ask Juno field.
- ⌘K's "New chat" page row. A person you have never messaged opens Home with them as the destination.
- The engine's `newchat` routes (picks, Frequent, conversation search) stay; Home calls them.

**Keys:**

| Key | Does |
| --- | --- |
| ⌘N | Focuses Home's composer and opens the destination list. Uses this tab if it is Home, else a Home tab that is open, else a new Home tab; if that Home has a draft, a new Home tab. |
| ⌘T, "+" | A new tab with Home, composer focused, Juno chosen. Closing the last tab and the first launch open Home too. |
| ⌘J | On Home, focuses the composer with Juno chosen. Elsewhere it opens the Juno chat, as today. |
| Tab | Needs you rows, then the recents (one stop; ↑↓ within a column, ←→ between the columns), then the chip, then the field. Shift Tab from the field reaches the chip. |
| Enter on a recent | Makes it the destination and moves focus to the field. ⌘Enter opens the conversation. |
| @ or # first, Juno chosen | The "Send to" list: ↑↓ move, Tab or Enter picks, Space or Esc keeps the text. |
| Backspace in an empty field | Destination back to Juno. |

**Tokens to add** when built: the "Send to" list width (320) and the chip's label limit (180), as `layout` entries in `tokens.stylex.ts` and `tokens.md`.

**Docs that change:**

- SPEC: §4 (pages in a tab), §5 item 1 (title bar), §6 (new tabs, Back after a send to Juno, tab icons, expiry with drafts), §9 (folded into §12), §10 (page rows, people results), §12 (Home), §14 (Settings › General), §18 (⌘N, ⌘T, ⌘J on Home).
- `inventory.md`: §1 (sidebar title bar), tabs, §8 (New chat), §11 (Home), Settings › General.
- `docs/design/new-chat/README.md`: marked superseded.
- `docs/performance.md`: the New chat open budget becomes Home's composer-ready budget.
- `packages/views/README.md` and `packages/state/README.md`.
- These proposal fixtures (`HomeMerged*`, `HomeWrite*`, `HomeQuiet*`) are deleted once Home is built, and only the shipped views keep fixtures.

**E2e tests that change:**

- `newchat.spec.ts` (11 tests) becomes the writing flows on Home, for example `home-write.spec.ts`: `@` and `#` pick, Space keeps the text, Backspace returns to Juno, a recent picks, send to a DM, send to a channel starts a thread, a never-messaged person, the draft kept and restored, "Draft closed · Undo".
- `home.spec.ts`: Ask Juno becomes the composer with Juno, and the caught-up test checks the scene and title only.
- `tabs.spec.ts` "closing the last tab opens a new tab…": Home always, ⌘N focuses Home's composer; the "New tabs open" part goes.
- The same checks run from Home in:
  - `send-checks.spec.ts` (3 New chat tests)
  - `mentions.spec.ts` "suggestions in New chat…"
  - `attachments.spec.ts` "a New chat keeps its files…"
  - `emoji-colon.spec.ts` "New chat supports Tab…"
- `palette.spec.ts` (the never-messaged person) and `palette-pages.spec.ts` (its page list includes "New chat").
- `screens.spec.ts`, `perf.spec.ts` "New chat open to first paint", `feel/newchat.feel.ts`, `feel/launch.feel.ts` and `feel/tabs.feel.ts`: Home in its place.
- `app.spec.ts`, `navigation.spec.ts`, `layout-shift.spec.ts`, `peek.spec.ts`, `break-pass-1017*.spec.ts` and `juno-agent/chat.spec.ts` start from the launch tab, a New chat today; they wait for Home instead.
- Driver: `NewChatPane` and `expectNothingOpen('New chat')` in `e2e/driver/juno.ts` fold into the Home pane. The "+" label "New chat ⌘T" becomes "New tab ⌘T".
- Gallery: the New chat cases in `newchat-geometry.spec.ts`, `focus-ring.spec.ts` and `list-geometry.spec.ts` move to Home, and the `NewChat` and `NewTabSetting` fixtures go.
