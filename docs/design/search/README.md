# Search tab (proposal, 2026-10-23)

Tushar's request: search is too basic. You can't filter by channel or person, choosing a result loses the search, and ⌘K is the wrong place to dig through messages. Search should be its own tab, with results in a column so you can check many of them quickly and open any one in a new tab. It should go beyond Slack, and use AI in quiet ways.

How we got here: a map of today's search (below), web research on what people like and dislike about Slack search (`rounds/research.md`, summarised under "Evidence"), and two design rounds between Fable (interaction design) and Astra (systems), in `rounds/`. Where they disagreed, the choice and the reason are given.

`mock.html` holds the first mocks, `mock-v2.html` the revision of 10-24 (cards, the topic beside them, the mark). `node ../../../scripts/heavy.mjs node render.mjs [--file mock-v2.html]` writes the PNGs.

The revision followed Tushar's look at the built tab: "this feels very busy, and i think the results part needs more space, and also larger rows showing more details so i don't have to open to see surrounding text", and, after seeing Slack's results, "search page isn't something you see all the time, but when you do go to it, you really want to find your thing fast and close the tab. it should be optimized for functionality." What each result can show, from Slack's answer and from the store, is in `v2-fields-light.png`.

## Today

- Search lives only in ⌘K's Messages tab: up to 8 local results from the FTS index, plus up to 4 from Slack's `search.modules.messages` after a 400 ms pause.
- Choosing a result closes the palette. The query, the results and the selection are lost, and ⌘K reopens on Conversations.
- Locally, `from:` and `in:` are searched as plain words. Matched words are not highlighted. Slack is asked for 20 results, with no sort and no paging.

## Evidence (short)

- The top complaint is that you must know the exact words. Others: bots and alert channels fill the results, old decisions get lost, it is slow, and jumping to a match to see its context is clumsy. Teams users say "it finds the message but there is no way of seeing the context".
- People like: modifiers (`from:`, `in:`, dates, `has:`, `-` to exclude), quotes for exact phrases, filter chips (Gmail built them so people need not remember operators), recent searches, a recent/relevant switch that stays where you set it.
- AI that works: plain words turned into visible filters you can edit, and answers with citations. AI that annoys: answers that make things up or change from run to run, hidden query rewriting, paywalls.

## The design

### 1. Search is a tab

- A new place, `search`. Each Search tab is its own session, with its own query, selection and scroll, so two searches can sit side by side.
- **Opening it.** ⌘⇧F opens Search in the current tab, or focuses the field when a Search tab is active. The sidebar's magnifier opens it too. In a topic, ⌘F opens Search scoped to that topic: a thread searches that thread, a Main searches its channel or DM. The scope is a chip ("in: Acme MSA renewal terms") that Backspace removes to widen the search. From ⌘K's Messages tab, a footer row "All results for "…" ⌘⇧F" carries the text and filters over.
- ⌘K stays for fast navigation, and always searches everything. Its tabs are **All**, **Conversations**, **Messages** and **Commands** (⌘1 to ⌘4), and it opens on All. The tabs sit in their own row under the field, not beside it, so the field keeps the full width.
  - **All** mixes the best of each kind in fixed groups: Conversations (up to 4), then Topics and messages (up to 5), then Pages, settings and commands (up to 3). Each heading shows its tab's key: "⌘2", "⌘3" and "⌘4". All may be taller than the other tabs, so its list cap is raised to fit the three groups. Rows stay where they are as you type; a group only fills in below what is shown.
  - **Conversations** is today's Conversations tab. **Messages** is the quick message list. **Commands** holds the app's actions: pages, settings, themes, accents and commands. Typing ">" first still shows only commands; it now switches to this tab.
  - Messages come from this Mac only, with no Slack call, so ⌘K never waits. The same hiding rules apply.
  - The last row on All and Messages is "All results for "…"" with ⌘⇧F. It opens the Search tab with the text and filters.
- The tab title is the query, or "Search" when empty. Privacy mode shows "Search".
- Search state lives outside the mounted page, so Back and Forward, a closed and reopened tab (⌘⇧T) and a restart all bring back the query, the selection, whether the topic showed beside the results, and the scroll (the card at the top and where it sat). The results are fetched again.

### 2. Results first, the topic beside them when you ask

- **The results take the tab.** The field, the filter row and the cards sit in the middle of the page, at most 780 px wide (`--search-measure`), so a line of a message stays readable. Nothing opens until you ask.
- **The topic shows beside the results** as a panel on the right: Space, a click or → on a card. 560 px by default, resizable from 480 to 800 by its left edge, with the mouse or, with the edge focused, ← → Home End and Enter; the results keep at least 320 px (`--search-list-min`). **Esc** hides it (from the list, or from the panel outside its composer), and so does Space again on the same card, or Close at the end of its header. While it shows, ↑ and ↓ move through the cards and the panel follows at once. Moving the selection never opens a tab or adds a history entry.
- The panel shows a new selection in the frame the selection moves, never the last topic's messages: a topic not on this Mac yet shows its header and the card's message at the match, and the rest fills in around it without moving it. Slack is asked only for the result the arrows stop on, after 120 ms of a still selection. The previous, next and hovered cards' topics are kept warm.
- No first-result preview: a new search selects nothing and shows no topic until you choose.
- **Enter** opens the topic at the message in the current tab, with Back returning to the search exactly as it was, panel included. **⌘Enter** or ⌘-click opens it in a new tab in the background, and focus stays in the list, so you can open several in a row.
- **The panel is the topic itself**, with its composer, reactions and message menus, at the match with the matched words marked. You can reply without leaving the search. Its header has the place, the title, **Open in new tab**, the topic's ⋯ menu and Close. When a thread has several matches, "2 of 5" with up and down arrows (⌘↑ ⌘↓) step between them, counted in the thread's reading order (oldest first), whatever the list's sort.
- **Reading marks read only when you act.** Arrowing past a result marks nothing read. Clicking or typing in the panel, reacting, sending, or opening the topic marks it read, as opening it does today.
- Tab moves focus from a card into the panel's composer; Esc in an empty composer goes back to the list.
- A new query whose results do not hold the selected card drops the selection and the panel.
- **Narrow:** under 800 px for the page (the results' minimum and a topic's), the panel covers the results, its header led by Back to results; Esc does the same. At the smallest widths the filter row wraps its two toggles to a second line, and under 480 px the panel's header keeps Back, the place icon, the title, the match arrows and ⋯; Open in new tab, Resolve and Juno move into ⋯.
- The sidebar's magnifier shows the current state while a Search tab is active, as Home and All topics do.

### 3. Cards: each result is its whole message

**The list is flat**: one card per matching message, in time order (newest first, or oldest with the sort). This is the order Slack returns, so pages only ever add cards at the end. There is no Group by thread.

- **A place line** over the card: the place's pill in its tint (public, private, DM) and, for a thread, Juno's title for it. A card from the same topic as the card just before it leaves the line out, so a run from one topic, as alert and incident channels often are, shows it once. This only looks at the card before, so the time order and the pages that add cards at the end do not change.
- **The card** is the message as the topic draws it: the sender's photo and name, "App" for an app or a bot, the date and time ("Oct 22, 20:41", "Yesterday 19:42", "10:41" today), then the whole message: rich text, code, quotes, mentions and links, its files as quiet chips (icon, name, kind and size; pictures show in the panel), and its reactions, read-only. A thread's first message ends with who replied (up to three faces, when Juno knows them) and "6 replies · last reply 2h". A press on a link or a mention inside a card is theirs.
- **A long message folds** at about ten lines (`--search-fold`). Folded, it shows the part with its first match, two lines under the fold's top, with a fade where more is above or below, and "Show more" unfolds it in place ("Show less" folds it again). Pressing it leaves the selection and focus where they were.
- The cards are calm: a hairline and space, no fill. The selected card takes a quiet tint (`--hl-select`: 10% of the accent in light, 9% in dark) and, while the list or the field has focus, an accent edge (`--hl-rule`). A card that takes focus is selected.
- **The search mark** is Find yellow, as every Mac app and Slack mark what you searched for, in the cards, in the panel and in Find in topic: `--find`, and `--find-current` for the match the panel's arrows are on (in dark, dark text on bright yellow, as macOS draws it). With an accent that is yellow itself (Marigold) the mark is blue, so it never looks like the @you chip or a link. Text on every mark is at least 8:1 (`v2-marks.png`; `docs/design/tokens.md`).
- **Topic titles match too.** Juno's titles are AI-made, so "staging bill" can find the topic titled "Staging bill doubled since August" even when nobody wrote those words. A topic whose title matches shows as a one-line card (its pill, the title with the words marked, its latest activity). Once above the completeness line, it stays for this query even when a later page finds an older matching message in that topic. Slack can't do this. Title matches obey `in:` and dates; with `from:`, only topics that person wrote in.
- **Where each part comes from.** Slack's answer (with `extra_message_data`) carries the text, blocks, attachments, files, reactions, the sender's id, an app's name and icon, `thread_ts`, and on a thread's first message `reply_count` and `latest_reply`. Names and photos, Juno's titles and who replied come from the store (`reply_users` was never seen in a search match). The engine builds each card as the topic builds a message (`packages/engine/src/searchCards.ts`).
- The engine sends 50 cards at a time (`SEARCH_WINDOW`), so a window of whole messages stays inside the live-query budget.

In the panel the "2 of N" counts matches in the whole thread as Juno holds it (the thread is fetched when opened), so it is exact even when the list has loaded only some of them.

### 4. The query: typed operators and chips are one thing

- One `SearchQuery` object, shared by the Search tab, ⌘K and the Juno agent's search tool. One parser, and two compilers: to SQL for the local index, and to Slack's modifier syntax.
- Operators: `from:`, `in:`, `before:`, `after:`, `on:`, `during:`, `has:` (link, file, reaction, pin), `is:thread`, quoted phrases and `-` to exclude. Two `in:` chips mean either conversation, as in Slack. Dates and date presets use the Slack profile's time zone, falling back to the system zone when the profile has none. `with:`, `is:saved` and `word*` are left out: the live check found `with:` unclear, and `is:saved` and `*` doing nothing. Juno adds `is:resolved`, `is:unresolved`, `is:pinned` and `in:` a sidebar view (v2), which Slack has no idea of.
- Typing `from:` or `in:` opens a picker, searched as ⌘K's Conversations tab is. The pick becomes a chip in the field. Clicking a chip edits it; Backspace at its edge removes it. Dates offer Today, Yesterday, This week, Last week, This month and a date.
- Under the field, a quiet row of filter buttons for the mouse: **From**, **In**, **Date**, **Has**, then the sort, and at the end the **Apps hidden** and **Automated hidden** toggles (see 6).
- Local filters must agree with Slack's: `has:link` checks attachment URLs too. `has:pin` means Slack-pinned messages and is Slack-only in stage A: Juno has no Slack message-pin cache, so this query returns no local rows and reports `needsSlack`. Offline it shows the offline state. Juno's sidebar topic pins are different; the v2 `is:pinned` filter will cover them.
- **Juno turns off Slack's own query rewriting** (`query_rewrite_disabled`). Slack quietly reads plain words as filters by default ("from me last week" became a person and a date and changed 163 matches to 805). What you see in the field is what was searched. Ask Juno to turn a question into a search (section 7).
- **The From and In menus show counts.** Slack's answer carries `filter_suggestions` with the top people and conversations and their match counts, even with rewriting off. The menus list them first ("Maya Chen 34"), so narrowing is one click.

### 5. Instant first, then complete, without rows jumping

- Local results paint on every keystroke (100 ms budget). Slack is asked after a 400 ms pause or at once on Enter, 50 per page, newest first (Slack honours 20, 50 and 100; larger values fall back to 20). Its snippets come with matched words marked; Juno marks local snippets itself.
- **One list, newest first, with a line where it stops being complete.** The local store holds about the last 7 days, plus older topics you've opened. Rows newer than what both sources have covered are complete. Older local rows sit under one quiet line, "Older matches on this Mac", and move up as Slack's pages reach them. Nothing above the line reorders. Rows that arrive above what you're reading keep your place, as the topic view does.
- More pages load as you near the end, one request at a time. A Slack answer for an old query is dropped.
- The states are different and say so: searching, no matches, Slack unavailable ("Showing matches on this Mac. Slack search didn't answer." with Try again), and offline.
- Sort: **Newest** and **Oldest** in v1. Slack's score sort is real (it reorders results, not just reverses them), so **Best match** comes in v2, with local matches as a small block above Slack's order, since the two rankings can't be merged.

### 6. Apps, bots and automated channels are hidden by default

- Two toggles at the end of the filter row, each remembered: **Apps hidden** (messages from apps and bots) and **Automated hidden** (the conversations in the Automated view, SPEC 5). One click shows them; the label then reads **Apps shown** or **Automated shown**. Nothing is hidden without a visible toggle saying so. They stay as two buttons in the row, with From, In, Date, Has and the sort, so every option can be found without opening a menu (decided 10-24 in the card revision, over folding them into one "Hidden" menu).
- Apps maps to `search_exclude_bots` on Slack (checked live: it removes every bot message) and the bot flag locally.
- Automated is Juno's own list, so Slack can't filter it: Slack's rows from those conversations are dropped after they arrive, and paging asks for more when a page thins out. Locally it is a `NOT IN` on the channel.
- When a search finds nothing but hidden rows would match, the empty state says so: "4 matches, all from apps and automated channels." with **Show 4 matches**.
- An `in:` chip naming an automated channel searches it whatever the toggle says.
- A card from an app says "App" next to its name, so an alert never reads as a person, when apps are shown.

### 7. Ask Juno

There are no separate AI search features: no words-to-filters suggestion, no Answer from results, no Summarize. Ask Juno instead: “What did Maya say about the vendor contract last month?”, “Find the thread where we moved the cutover” or “Show alerts from #ops yesterday, including bots.” Juno writes the query and filters itself and runs this tab's search: the same parser, names, local index and Slack history, newest first. It includes apps and automated conversations when the question needs them, can search oldest first and asks for more pages. Its answer cites the messages it found, and a citation opens the message in its topic. If Slack search fails, Juno says it searched only this Mac. Juno cannot open this tab from the chat; its citations open topics.

**Matching AI titles** (section 3) stays: Juno's existing titles match alongside message text, without another model call.

Rejected: an answer card above the results, AI reranking, an AI top hit, merging similar results with a model, auto-summaries on selection, confidence scores, badges for saved searches.

### 8. Empty field

- Recent searches (the last 10, with their filters; × removes one), then a short line on operators.
- Under it, a line pointing to ⌘K for quick navigation, since the sidebar's magnifier now opens this page: "To jump to a conversation, topic or command, press ⌘K." with the key shown as a key cap, and clicking it opens ⌘K. It shows on the empty field only, never over results.
- A pinned Search tab is a kept search. No new "saved search" object in v1.

## Plan

v1, in order:

1. Done (10-24): read-only live checks of Slack search, in `docs/research/slack-data-access.md`, "Search for the Search tab, live (2026-10-24)". Their results are folded into this page.
2. Done (10-24): `SearchQuery`, the parser and both compilers. ⌘K and the agent tool move onto it.
3. Done (10-24): the `search` place with sessions, the two-pane page, the reader, keys, ⌘⇧F, ⌘F in a topic, the ⌘K handoff. SPEC 10a describes what was built.
4. Done (10-24): merge with the completeness line, paging, highlighting, the four states, the Apps and Automated toggles.
5. Done (10-24): flat rows, title matches, stepping between matches.
6. Done (10-24): recent searches; privacy mode.
7. Done (10-24): Juno answers search questions with this tab's search and cites the messages (section 7).
8. Done (10-24): the card revision (sections 2 and 3): results first, the topic as a panel, cards with whole messages, the search mark; Group by thread removed.

v2: Best match, Juno-only filters, Files, and a semantic index only if we see many searches that find nothing.

Tests: end-to-end flows against the fake Slack (which needs the extra operators, paging and `search_exclude_bots`), a perf spec for keystroke-to-results and arrow-to-reader, and unit tests only for the parser and compilers.

## Decisions

None. Decided with Tushar (10-24, card revision): results take the tab and the topic shows as a panel beside them only when asked; results are cards with the whole message; the mark is Find yellow (blue for a yellow accent), never the accent; Group by thread is gone; the filter row keeps every control visible. Decided earlier (10-24): the reader is not read-only; ⌘F in a topic searches that topic; apps and automated channels are hidden by default behind visible toggles; ⌘K stays for fast navigation: All, Conversations and Messages tabs, opening on All, local-only results and a row into the Search tab.
