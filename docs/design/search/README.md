# Search tab (proposal, 2026-10-23)

Tushar's request: search is too basic. You can't filter by channel or person, choosing a result loses the search, and ⌘K is the wrong place to dig through messages. Search should be its own tab, with results in a column so you can check many of them quickly and open any one in a new tab. It should go beyond Slack, and use AI in quiet ways.

How we got here: a map of today's search (below), web research on what people like and dislike about Slack search (`rounds/research.md`, summarised under "Evidence"), and two design rounds between Fable (interaction design) and Astra (systems), in `rounds/`. Where they disagreed, the choice and the reason are given.

`mock.html` holds the mocks. `node ../../../scripts/heavy.mjs node render.mjs` writes the PNGs.

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
- Search state lives outside the mounted page, so Back and Forward, a closed and reopened tab (⌘⇧T) and a restart all bring back the query, the selection and the scroll. The results are fetched again.

### 2. The field across the top, results on the left, the conversation on the right

- **The field and the filter row span the whole tab**, above the split, so long queries and several chips have room. The split starts under them.
- **Results column** 384 px wide, resizable from 312 to 480 by its edge, like the sidebar, with the mouse or, with the edge focused, ← → Home End and Enter. The **reader** takes the rest.
- Until you choose a row, a new search's first result shows in the reader as a peek once Slack has answered (its answer can put a newer match first), so the reader is not left blank; it marks nothing read and focus stays in the field. A row that takes focus (Tab into the list, a click) is selected, so the tint always shows where you are.
- Up and Down move through the results, and the reader follows at once (it reads from the local store, within the 50 ms cached topic budget; the results next to the selection and under the pointer are kept warm). It never keeps the last topic on screen: a result whose topic is not local yet shows its header and its own message from the row, where the match lands, and the topic fills in around it. A held arrow asks Slack only for the result it stops on. Moving the selection never opens a tab or adds a history entry.
- **Enter** opens the topic at the message in the current tab, with Back returning to the search exactly as it was. **⌘Enter** or ⌘-click opens it in a new tab in the background, and focus stays in the list, so you can open several in a row.
- **The reader is the topic itself**, with its composer, reactions and message menus, scrolled to the match with the matched words marked. You can reply without leaving the search. Its header has the title, the place, **Open in new tab** and the topic's ⋯ menu. When a thread has several matches, "2 of 5" with up and down arrows (⌘↑ ⌘↓) step between them, counted in the thread's reading order (oldest first), whatever the list's sort.
- **Reading marks read only when you act.** Arrowing past a result marks nothing read, as a peek. Clicking or typing in the reader, reacting, sending, or opening the topic marks it read, as opening it does today.
- Tab moves focus from the list into the reader's composer; Esc in an empty composer goes back to the list.
- Narrower than 312 + 480 px: one column. Enter shows the reader with "Back to results"; Esc does the same.
- At the smallest widths the filter row wraps its two toggles to a second line, and under 480 px the reader's header keeps Back, the place icon, the title, the match arrows and ⋯; Open in new tab, Resolve and Juno move into ⋯.
- The sidebar's magnifier shows the current state while a Search tab is active, as Home and All topics do.

### 3. Rows: a flat list by time, or grouped by thread

**By default the list is flat**: one row per matching message, in time order (newest first, or oldest with the sort). This is the order Slack returns, so pages only ever add rows at the end.

- A row is two lines. Line 1: the topic's art (16), its Juno title (a Main reads "#procurement · Main"), the place, and the time. Line 2: the sender and the snippet, with the matched words in semibold.
- A match from the same topic as the row just before it is a one-line match line instead (sender, snippet, time, as grouped mode draws them), under that row's snippet. A run from one topic, as alert and incident channels often are, shows its topic line once and the snippets that differ under it; topics that alternate keep a full row each. This only looks at the row before, so the time order and the pages that add rows at the end do not change.
- A snippet starts a few words before the first match, with a leading "…" when cut, so the matched words are always visible.
- **Topic titles match too.** Juno's titles are AI-made, so "staging bill" can find the topic titled "Staging bill doubled since August" even when nobody wrote those words. A topic whose title matches shows as a one-line row with the words marked, at the time of its latest message. Once above the completeness line, it stays for this query even when a later page finds an older matching message in that topic. Slack can't do this. Title matches obey `in:` and dates; with `from:`, only topics that person wrote in.

**Group by thread** is a toggle in the filter row, next to the sort, and is remembered. Slack returns single messages, each with its thread (`thread_ts`), so grouping happens in Juno over the rows loaded so far:

- A thread's matches sit under one topic line (art, title, place, time of its newest loaded match), with up to 2 match lines, then "3 more in this thread".
- A thread's group sits where its newest loaded match falls in time order. Newest first, a later page can only hold older matches, so it adds lines to a group already shown and never moves a group up. Under Oldest first the same holds in reverse.
- "N more in this thread" counts the matches loaded so far and grows as pages arrive. It never claims a total Slack hasn't sent.
- A channel's Main is not one conversation, so Main matches stay single rows; consecutive Main rows from the same channel share one header line.
- Grouping uses thread identity only, never a model's sense of similarity. Similar bot messages are not merged: two alerts can be two incidents.

In both modes the reader's "2 of N" counts matches in the whole thread as Juno holds it (the thread is fetched when opened), so it is exact even when the list has loaded only some of them.

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

- Two toggles at the end of the filter row, each remembered: **Apps hidden** (messages from apps and bots) and **Automated hidden** (the conversations in the Automated view, SPEC 5). One click shows them; the label then reads **Apps shown** or **Automated shown**. Nothing is hidden without a visible toggle saying so.
- Apps maps to `search_exclude_bots` on Slack (checked live: it removes every bot message) and the bot flag locally.
- Automated is Juno's own list, so Slack can't filter it: Slack's rows from those conversations are dropped after they arrive, and paging asks for more when a page thins out. Locally it is a `NOT IN` on the channel.
- When a search finds nothing but hidden rows would match, the empty state says so: "4 matches, all from apps and automated channels." with **Show 4 matches**.
- An `in:` chip naming an automated channel searches it whatever the toggle says.

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
5. Done (10-24): flat rows and Group by thread, Main rows, title matches, stepping between matches.
6. Done (10-24): recent searches; privacy mode.
7. Done (10-24): Juno answers search questions with this tab's search and cites the messages (section 7).

v2: Best match, Juno-only filters, Files, and a semantic index only if we see many searches that find nothing.

Tests: end-to-end flows against the fake Slack (which needs the extra operators, paging and `search_exclude_bots`), a perf spec for keystroke-to-results and arrow-to-reader, and unit tests only for the parser and compilers.

## Decisions

None. Decided with Tushar (10-24): the reader is not read-only; ⌘F in a topic searches that topic; the field spans the tab above the split; apps and automated channels are hidden by default behind visible toggles; ⌘K stays for fast navigation: All, Conversations and Messages tabs, opening on All, local-only results and a row into the Search tab.
