# Home merged with New chat

Round 2, after the owner's feedback (one composer at the bottom, Juno by default, @ and # to pick, generous recents), is in `round-2/README.md`.

Three proposals for one Home that shows what needs you, lets you write to anyone, and asks Juno, so New chat stops being a separate page. Nothing here is built into the app yet; the owner picks a direction first.

Each direction is a gallery fixture made from the real `Home`, `Composer`, `DestinationPickers` and Frequent rows (`packages/views/src/HomeMerged.tsx`, `HomeMerged.fixtures.tsx`, gallery components `HomeMergedA`, `HomeMergedB`, `HomeMergedC`). The screenshots in `A/`, `B/` and `C/` come from `GALLERY_SHOTS_ONLY=HomeMergedA,HomeMergedB,HomeMergedC pnpm gallery:shots`, a 1056 by 720 workspace (a 1440px window less the sidebar), light and dark:

| State | File |
| --- | --- |
| Items waiting | `items-waiting-{light,dark}.png` |
| Caught up | `caught-up-{light,dark}.png` |
| Writing, destination picked | `writing-{light,dark}.png` |
| First run, no history | `first-run-{light,dark}.png` |
| Narrow window (640, C at 720) | `narrow-{light,dark}.png` |

All three keep Home's order: scene, greeting, then what needs you. Home no longer links to All topics (decided 10-17).

## A · One field

Juno is the first destination, so asking Juno and writing a message are one composer. The row above the field holds Juno, the top three Frequent conversations and "Someone else" (@, which opens the full conversation list). The chosen one takes its context tint, as the picker does in New chat; a thread pill ("Main") appears at the end of the row once a conversation is chosen. The placeholder says where Enter goes: "Ask Juno, or pick who to write to", then "Message Maya Chen".

- Items waiting: the rows lead, the field closes the column where Ask Juno is today.
- Caught up: the field sits right under "Nothing is waiting on you." and is the one thing to do.
- First run: the row is Juno and "Someone else".
- Keys: ⌘N focuses the field with the conversation list open; ⌘J focuses it with Juno chosen. Tab goes rows, then the destination row (one stop, arrows move inside it), then the thread pill, then the field.

Trade-offs. One primary action per view, and no second field-shaped control. The page stays as calm as today's Home. The risk is sending to the wrong place: Juno is the default, so a message meant for a person goes to Juno, which is private, rather than the reverse; the tint and placeholder say which. Only three Frequent conversations fit at 480px; the rest are one press away under @.

## B · Composer at the foot

Home stays exactly as it is, Ask Juno included. New chat's pickers and composer sit at the bottom of the page, where every topic's composer is. Frequent trails the picker row as six faces (avatars, or the channel glyph), each one press, with the name as the tooltip.

- Items waiting and caught up: Home in the middle, the composer at the bottom, unchanged by state.
- Writing: the pickers show the destination tint and the thread title, as in New chat today.
- First run: the pickers alone.
- Keys: ⌘N focuses the bottom composer, ⌘J the Ask Juno field (or the Juno tab, as today). Tab goes rows, Ask Juno, pickers, faces, composer.

Trade-offs. The least new design: both pages keep their parts and the composer is where you expect it. But it puts two field-shaped controls on one page, Ask Juno and "Write a message", 480 and 752px wide, which compete. Channel faces are all "#" or a lock, so two channels look the same until you hover; the name is only in the tooltip. The composer is far from the items, so the eye has two places to start.

## C · Two columns

What needs you on the left, as Home shows it. Writing on the right, as New chat shows it: the Frequent rows with their hint, then the pickers and the composer. Below 880px the columns stack, writing second (`narrow`).

- Writing: the chosen Frequent row is marked, the pickers take the tint.
- First run: the right column has the hint and the composer.
- Keys: ⌘N focuses the right composer, ⌘J Ask Juno. Tab goes left column, then right.

Trade-offs. Shows everything at once, with all six Frequent rows named. It is the busiest: two columns and two fields, and the right column is a second page set beside Home, not a merge. The calm, centred resting page becomes a dashboard, and on a narrow window the composer drops below the fold.

## Recommendation: A

By the better-interface rules:

- **One primary action per view** (layout): A has one field and one send. B and C each have two field-shaped controls.
- **Group with space, order by importance** (layout): A is one centred column, rows then the field, and caught up the field moves up under the greeting with nothing else changing. B splits the page into a middle and a foot; C into two columns.
- **Controls distinct and named** (layout, accessibility): telling two of B's channel faces apart needs a hover or a screen reader; A and C name every destination on screen.
- **Delete first** (better-interface, cheaper fix): A removes Ask Juno as a separate control and New chat's preview area; B and C keep both.
- **Always know where you are posting** (SPEC principle 4): A keeps the context tint on the chosen destination and the placeholder names it; the default is Juno, which only you see.

What A needs before building: the destination row is a radio group (one Tab stop, arrows move, `aria-checked`), not the toggle buttons the fixture uses; more Frequent chips when the column is wider; Enter with Juno chosen opens the Juno chat in this tab with the question sent, and Back returns to Home.

## What goes away once merged

Not implemented yet. For the chosen direction:

- **The sidebar's New button** (the `NotePencil` IconButton "New chat" in `Sidebar.tsx`, `onNewChat`). Home is one click away in the navigation, and ⌘N stays.
- **Settings › General › Tabs "New tabs open"** (`NewTabSetting`, `state/newTabPage.ts`, the `newTabPage` preference). There is only one new-tab page, Home. "Close tabs not viewed in" stays in that group.
- **New chat as a page and tab type** (`newChat` place in `state/tabs.ts`, `containers/NewChat.tsx`, `views/NewChat.tsx`, the New chat tab icon and title rules, the preview). Home takes its draft: the text, destination and files are saved with the Home tab and survive a restart; a Home tab with a draft never closes by itself; closing it shows "Draft closed · Undo". The engine's `newchat` routes (picks, Frequent, conversation search) stay; Home calls them.
- **⌘T and "+"** open Home in a new tab. Closing the last tab opens Home.
- **⌘N** focuses the composer of the Home in the current tab, or of a Home tab that shows one, with the conversation list open; if that Home has a draft, it opens a new Home tab. ⌘K's "New chat" page row becomes "New message"; a person never messaged opens Home addressed to them.
- **After a send** the tab opens the topic as New chat does now, but pushes a history entry, so Back returns to Home with an empty field.

### Docs that change

SPEC §4 (pages in a tab), §5 item 1 (title bar), §6 (new tabs, Back after send, tab icons, expiry with drafts), §9 (rewritten as part of §12), §10 (palette page rows, people results), §12 (Home), §14 (Settings › General), §18 (⌘N, ⌘T); `inventory.md` §1 (sidebar title bar), tabs, §8 (New chat), §11 (Home), Settings › General; `docs/design/new-chat/README.md` (marked superseded); `docs/performance.md` (the New chat open budget becomes Home's); `packages/views/README.md`, `packages/state/README.md`.

### E2e tests that change

- `newchat.spec.ts` (11 tests): moves to Home, for example `home-write.spec.ts`; the flows stay (pick, thread first, never-messaged person, send, draft kept and restored, Draft closed · Undo).
- `tabs.spec.ts` "closing the last tab opens a new tab…": Home always, ⌘N focuses Home's composer; the "New tabs open" part goes.
- `send-checks.spec.ts` (3 New chat tests), `mentions.spec.ts` "suggestions in New chat…", `attachments.spec.ts` "a New chat keeps its files…", `emoji-colon.spec.ts` "New chat supports Tab…": the same checks from Home.
- `palette.spec.ts` "a person's result opens your DM, or a New chat…" (the never-messaged person) and `palette-pages.spec.ts` (its list of page rows includes "New chat").
- `screens.spec.ts` "New chat with a destination…", `perf.spec.ts` "New chat open to first paint", `feel/newchat.feel.ts`, `feel/launch.feel.ts`, `feel/tabs.feel.ts`: Home in its place.
- `app.spec.ts`, `navigation.spec.ts`, `layout-shift.spec.ts`, `home.spec.ts`, `peek.spec.ts`, `break-pass-1017*.spec.ts`, `juno-agent/chat.spec.ts`: they start from the launch tab (a New chat today) and wait for it; they wait for Home instead.
- Driver: `NewChatPane` and `expectNothingOpen('New chat')` in `e2e/driver/juno.ts` become part of the Home pane; the "+" label "New chat ⌘T" becomes "New tab ⌘T".
- Gallery: `newchat-geometry.spec.ts`, `focus-ring.spec.ts` and `list-geometry.spec.ts` cases for New chat move to Home; `NewChat` and `NewTabSetting` fixtures go.
