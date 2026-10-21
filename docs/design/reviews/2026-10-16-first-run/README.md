# Design review, 2026-10-16: the first run

The owner is about to use Juno every day for the first time. This review walks the first run as a new user does, against the fake Slack (and a fake OpenRouter for Juno): launch with no account and sign in, by importing the Slack app's session; the first sync; the first Home, All topics, topic and ⌘K; Juno with no provider, then a key, a model and the first chat; the empty states; and AI assist off from the start. It follows the method of `../2026-10-16/` and checks against SPEC sections 5, 10 to 13, 16 and 17, `inventory.md`, `tokens.md` and `primitives.md`. The fixes are on `first-run-1`.

## Scope and how it was checked

- **The app.** `harness/review.spec.ts` drives the built app at 1400 × 900 (and 720 × 600 for sign-in and Home). It shoots each state in light and dark and writes what the window holds over time (`harness/out-*/snapshot-*.json`, `series-*.json`). To see the first sync, it holds the fake's `client.userBoot`, then `conversations.history`, and shoots each hold. A third test signs in to the fake's 1,200-topic seed and shoots every two seconds for 90 seconds.
- **Runs.** `before/` is `520f9429` (main), `after/` is this branch. The harness writes PNGs; they are kept here as half-size JPEGs, and of the time series only the first frames are kept. `compare/` stacks before over after for each fix. Run from `apps/desktop` after `pnpm build`: `REVIEW_SET=after REVIEW_ONLY=signin,import,cold,pages,juno,aioff,setup node ../../scripts/heavy.mjs pnpm exec playwright test -c ../../docs/design/reviews/2026-10-16-first-run/harness/desktop.config.ts`.
- **AI assist off.** The app has no switch for it (finding 3), so the harness writes the pref into the workspace database and relaunches, as `home.spec.ts` does.
- **Not reviewed.** A real cold boot. The fake answers in milliseconds, so even the 1,200-topic seed had rows in 2.3 s and Home ready at once (`out-before/series-cold.json`; its `engine` field is the supervisor's state, not the sync phase, so the series ran its full 90 s). The held calls stand in for a slow Slack. Also not reviewed: the macOS keychain prompt for the import, which the fixture skips; VoiceOver; native menus.

What held up:

- The sign-in page is short and plain, keeps a line for its status so nothing moves, and its primary button waits during import ("Reading the Slack app’s session").
- The import from the Slack app's session is instant on the fake and lands on the same first Home.
- The first topic, All topics and ⌘K look as finished as in the earlier reviews.
- The provider page rejects a bad key in one plain line ("That is not a key. Keys have no spaces."), and the model list reads as names and prices.
- Activity, Scheduled and What Juno remembers say why they are empty and what fills them.
- The Notifications page and the ignore list read well empty ("Every channel and person is set to When it matters.", "Nothing ignored.").

## Findings, worst first

Severity: **high** looks broken or blocks the flow; **medium** is a visible defect under the existing rules; **low** is polish.

### 1. During the first sync the sidebar said "It's quiet" and Home was blank. High. Fixed.

Right after sign-in, until the first conversations arrive, the list showed the quiet empty state: "It's quiet. Topics with activity in the last 7 days show up here. View all topics". Home stayed blank until the first sync finished, even with rows in the sidebar. On a real workspace that is minutes of a page that looks broken, beside a sidebar that says there is nothing.

- Before: `before/03-signed-in-boot-held-*`, `before/04-history-held-*` (rows, blank Home).

**Fix.**

- The sidebar shows "Getting your topics" with "Juno is reading your conversations from Slack. Topics show up here as they arrive." It has no illustration and no button. This shows while the engine's phase is before `live` and nothing has arrived.
- Home's blank page is left to the `real-data-1` work, which fixes it and adds a sync progress line to the sidebar header. This branch first gave Home a "Getting your conversations from Slack." line (`ebd52cd8`), then reverted it (`1fcd1d61`) so the two do not collide.
- The gallery has `Sidebar` › Empty › `syncing`. `sidebar.spec.ts` holds the boot and checks the sidebar.
- After: `after/03-signed-in-boot-held-*` (shot before the revert, so its Home still has the line). Compare: `compare/01-first-sync-*`.

### 2. With AI assist off, the Juno tab asked for a model, and Home kept Ask Juno. High. Fixed.

SPEC 13.7 says that with AI off the chat shows one line, "Juno is off. Turn on AI assist in Settings.", and its composer is disabled. Instead the tab showed "Juno needs a model" and Add a provider, which would not turn Juno on. Home kept its Ask Juno field, an AI surface that the inventory says is left out while AI assist is off.

- Before: `before/31-ai-off-juno-*`, `before/30-ai-off-home-*`.

**Fix.**

- With AI assist off, the tab skips the no-provider page. When no agent runs to say so, the chat reads the switch itself. So it shows the AI-off line with the composer off whether or not a provider is set up.
- An empty chat with AI off is the one line: the "What do you need?" suggestions, which it cannot act on, are left out. The disabled composer is dimmed (`--opacity-disabled`), as a disabled control is. It looked like an ordinary empty composer. The gallery has `JunoChatList` › States › `ai-off-empty`.
- Home leaves Ask Juno out.
- `home.spec.ts`'s AI-off test checks both. Until now it expected Ask Juno to show; that line predates the Juno chat.
- After: `after/31-ai-off-juno-*`, `after/30-ai-off-home-*`. Compare: `compare/02-ai-off-juno-*`, `compare/02b-ai-off-home-*`.

### 3. There is no way to turn AI assist off. High. Question Q1.

SPEC 15 has a global AI assist switch, and the inventory puts it in the avatar menu as a proposed switch. Neither the menu nor Preferences has it (`before/33-ai-off-account-menu-*`), and the AI-off line points to "Settings". A new user who wants Juno without AI cannot get there. Building it is a product change, so it is left as a question.

### 4. Until the people list arrives, names show as Slack user ids. Medium. Not changed (engine).

During the first sync, rows read "U0DEV: Booked 2–4pm…", a DM is titled "U0MAYA", and every avatar shows "U" (`before/04-history-held-*`, `before/05-sync-00`). Home's greeting has no first name for the same reason ("Still up." in `after/04-history-held-*`). The names arrive a moment later on the fake, and later on a slow Slack. The engine falls back to the id (`userName` in `packages/engine/src/topicRows.ts`). The cure is to load people before the first rows are written, which is the cold-boot work in progress, so this is handed to it rather than changed here. See Q2.

### 5. Bot channels show in All during the first sync, then leave for Automated. Medium. Not changed (engine).

`#alerts-prod` is the first row in `before/05-sync-00`. A moment later it has moved to Automated, the Automated pill appears, and every row moves up (`before/05-sync-01`). SPEC 5 promises a bot channel is not in All after the first sync, which holds, but the move is visible while you watch. Sorting a channel as it is written, not after, belongs to the same sync work as finding 4.

### 6. A view with no conversations said "It's quiet". Medium. Fixed.

A view made with only a name showed the quiet state about the last 7 days, which is not why it is empty (`before/15-empty-view-*`).

**Fix.** "No conversations in this view" with "Add channels and people to see their topics here." and Edit view, which opens the view's sheet. A view with conversations but nothing recent still says "It's quiet". `views.spec.ts` checks it, and the gallery has `Sidebar` › Empty › `empty-view`. The inventory's sidebar empty table now has the copy that is built. Before this it listed copy from the prototype.

- After: `after/15-empty-view-*`. Compare: `compare/06-empty-view-*`.

### 7. Settings › Juno moved up under the pointer when the agent started. Medium. Fixed.

Before a provider is set up, the page's intro was the two-line "Juno runs on a model provider you choose…". About 0.9 s after Save (`out-before/timing-model-section.json`), the agent's part arrived and the intro became the one-line "Models, spend, rules and where Juno's state lives…". The Provider section, under the pointer that had just pressed Save, moved up 23px (`before/23-after-save-0` against `before/23b-settings-with-model-*`).

**Fix.** Before the agent runs, the intro is "Models, spend and the provider. Only you can change these.", one line like the full page's. The no-provider page still explains the choice. Geometry: the Provider heading is at the same height before and after the agent arrives (`after/22-settings-provider-*` against `after/23b-settings-with-model-*`). Compare: `compare/07-settings-juno-*`.

### 8. All topics' column heads moved when a filter emptied the table. Low. Fixed.

The table's scroller dropped its scrollbar gutter when nothing overflowed, so Where, Status, Msgs and Updated moved 10px right as the table emptied (`before/11-all-topics-*` against `before/11b-all-topics-no-match-*`). The scroller now keeps the gutter, as `Page` and `ScrollArea` already do. After: `after/11b-all-topics-no-match-*`. Compare: `compare/08-all-topics-empty-*`.

### 9. The Juno tab's suggestions talk about a topic that is not there. Medium. Not changed.

The empty chat in the Juno tab offers "Summarize this topic" and "Draft a reply in this topic" (`before/24-juno-empty-chat-*`). In the tab there is no topic, so the first two things a new user might press have nothing to work on. The suggestions are chat copy, which the agent backlog sweep is changing, so this is handed over. See Q3.

### 10. The sign-in page shows Theme and Accent in its bottom corner. Low. Question Q4.

At 1400 × 900 the appearance block sits at the window's bottom-left, outside the centred column, 17px from the bottom edge (`before/01-sign-in-*`). At 720 it lines up with the column (`before/01b-sign-in-720-*`). No Mac app asks for an accent colour before you sign in, and Preferences has the same controls.

### 11. The avatar menu shows the Slack handle and the diagnostics. Low. Question Q5.

The menu's header reads "tushar", the handle, where the rest of the app says "Tushar". Under the items are Session ("Signed in to Juno Fake as tushar · Sign out") and Diagnostics ("Juno 0.1.0 on darwin, Electron 44.7.0", "Engine starting", Ping engine). During the first sync, "Engine starting" is the only sign of progress, and it reads like a fault (`before/03b-account-menu-boot-held-*`). The inventory keeps these until Sign out is an item. The avatar menu, its hover and Diagnostics belong to the `settings-one` work, so this review changes none of them.

### 12. Smaller observations. Low. Not changed.

- **⌘K "No matches."** It has no next step, which SPEC 16 asks of an empty state (`before/13b-palette-no-matches-*`). The inventory already records this. See Q6.
- **Two page widths.** Activity, Scheduled, What Juno remembers and Connections use the 720 column. Settings › Juno, Notifications and Preferences use 760. Moving between them, the title moves 20px. This is as specified (`Page` widths). See Q7.
- **What Juno remembers, empty**: "0.0 KB of 4.0 KB used." is noise until something is pinned.
- **The key field after Save** is empty with its "sk-or-…" placeholder beside a "Key set" chip. For a moment Save stays filled (`before/23-after-save-0`). A masked value ("sk-or-…cdef") would say what is stored.
- **A Home title at 720** is cut at a word with a space before the ellipsis ("Elena asks: She has a …", `before/10b-home-720-*`).
- **Connections intro.** It said "A tool on a server's read list needs no click; everything else is a card, every time." Tools now have one "Runs without asking" checkbox and no read list. Fixed: "Where Juno can read and act. Tools that run without asking need no click; everything else asks with a card."
- **Apostrophes.** The sign-in page uses straight ones ("I'm", "app's") and its status line a curly one ("Slack app’s session").

## Added after the review: Set up Juno

The owner tried the real app and could not find where to add the OpenRouter key. The model setup is now part of signing in. After the first Slack sign-in, with no provider set up, the sign-in page shows "Set up Juno" before the app.

- **The choices:**
  - OpenRouter, with its API key.
  - OpenAI-compatible, with a base URL and an optional key.
  - Codex, only when it is installed. Sign in to Codex runs `codex login` in Juno's own Codex home, which opens the browser.
- **Saving:** the key goes through `setAgentProvider` to the keychain, the same path as Settings › Juno. The agent then starts, and a Model row offers its chat models, with Sonnet already chosen.
- **The buttons:** Continue saves the key, then finishes. Skip for now opens the app with AI assist on, and the Juno tab says "Juno needs a model" as before.
- **When it shows:** once, after a first sign-in. It does not show after "Slack signed you out", or when a provider is already set up.
- **The page:** the sign-in page and the step share `SignInPage`, so the mark, title, body and status line sit in the same place on both.
- **Docs:** SPEC section 4 has a new "Sign-in" part, the inventory has 1.1, and the architecture doc lists `agent.codex` and `agent.codexSignIn`.
- **Shots:** `after/40-set-up-*` (720: `40b`), `41-set-up-custom-*`, `42-set-up-bad-key-*`, `43-set-up-saving`, `44-set-up-model-*`, `45-after-set-up-*`.
- **Tests:** `e2e/juno-agent/set-up.spec.ts` covers sign-in, then set-up and the first chat, and sign-in, then Skip. The e2e driver's `signIn` and `importFromSlackApp` press Skip for now unless a test passes `skipSetUp: false`.
- **Not covered by a test:** Codex. No Codex is installed under tests (main looks only at `JUNO_E2E_CODEX`), and Codex's browser sign-in was not tried against a real Codex.

## Questions for the owner

Each has a recommendation. They are left open because each changes what a surface offers or how it reads.

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Where does AI assist get turned off? | Build the avatar menu item the inventory proposes ("AI assist" with a switch), and also put it in the Juno section of the merged Settings page (`settings-one`). Point the AI-off line at the menu: "Juno is off. Turn on AI assist in the account menu." |
| Q2 | During the first sync, show people before rows, or rows with a placeholder name? | Load the people list with the boot, before the first rows are written, so no row ever shows an id. If that cannot be done, show the row without its sender ("Booked 2–4pm…") rather than an id. |
| Q3 | What does the empty Juno tab suggest? | In the tab: "Catch me up on today", "What needs me?", "Anything settled I can resolve?". Keep the topic suggestions for the panel beside a topic. |
| Q4 | Keep Theme and Accent on the sign-in page? | Remove them. The window follows the system theme, and Preferences has both after sign-in. |
| Q5 | When do Session and Diagnostics leave the avatar menu? (For the `settings-one` work, which owns the menu.) | Now. Make Sign out the menu's last item, move the version to Preferences › About (it is already there), and keep Ping engine for development builds. Show the real name in the header. |
| Q6 | What does ⌘K offer when nothing matches? | "Search Slack for "…"" as the one row when Slack search is wired; until then "No matches. Try fewer words." |
| Q7 | One page width for every settings-like page? | Yes, 760 for all of them, so the titles stay put when switching tabs. Juno's chat column stays 720. |
| Q8 | Should Home say "Nothing is waiting on you" while the first sync is still catching up? (For the `real-data-1` work.) | Home is ready once the boot is done, but older conversations still arrive after that (`series-cold.json`: "Nothing is waiting on you." at 2.3 s). Keep "Getting your conversations from Slack." until the engine is `live` on the first run, then show the items. |

## Commits on `first-run-1`

- `84679b78` Say the sidebar is getting topics during the first sync, and name an empty view (findings 1, 6)
- `ebd52cd8` Show the greeting on Home during the first sync (1), reverted by `1fcd1d61` for the real-data work
- `fb490553` Keep the All topics scrollbar gutter, so the column heads stay put when the table empties (8)
- `1e247984` With AI assist off, say Juno is off and leave Ask Juno off Home (2)
- `fc59de67` Keep Settings › Juno's intro to one line before the agent runs (7)
- `57929c79` Show Juno's AI-off line when AI assist is off and no agent runs (2)
- `ac0d88e3` With AI assist off, show the empty chat as the one AI-off line, with the composer dimmed (2)
- `9bba2cc2` Rewrite the Connections intro for the Runs without asking checkbox (12)
- `b702da7f` Let the renderer check local Codex and sign in to it, in Juno's own Codex home (Set up Juno)
- `9ab9bb32` Show Set up Juno after the first Slack sign-in
- `6bad4ef3` Describe sign-in and Set up Juno in the spec, inventory and architecture
- This review (the document, the harness, the shots).

## Verification

- `pnpm --filter <package> typecheck` for views, state and desktop after each change. `pnpm build` stays under budget (JS 953.4 KB, CSS 117.3 KB).
- Locally under the heavy lock: `home.spec.ts`, `views.spec.ts`, `sidebar.spec.ts`, `juno-agent/providers-ui.spec.ts` and `juno-agent/states.spec.ts` passed, including the new tests for the first sync, the empty view and AI assist off.
- `pnpm affected` after merging origin/main: typecheck, lint, `pnpm test`, `test:gallery` and `test:desktop` (235 passed, 32 skipped) all passed.
- The harness ran before (clean `520f9429`) and after (this branch). The after run covers sign-in, the pages, Juno setup and AI assist off. The import and the long cold boot have no change, so they were not run again.
- Not run: `pnpm test:feel`. The lock was held by perf runs for most of this review. These changes add empty-state copy and one opacity, and touch no list, scroll path or animation.
