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
- ⌘K stays for fast navigation, and always searches everything. Its tabs are **All**, **Conversations** and **Messages**, and it opens on All. The tabs sit in their own row under the field, not beside it, so the field keeps the full width.
  - **All** mixes the best of each kind in fixed groups: Conversations (up to 4), then Topics and messages (up to 5), then Pages, settings and commands (up to 3). The Conversations and Topics and messages headings show "⌘2" and "⌘3" for their tabs; the commands group has no tab and no hint. All may be taller than the other tabs, so its list cap is raised to fit the three groups. Rows stay where they are as you type; a group only fills in below what is shown.
  - **Conversations** is today's Conversations tab. **Messages** is the quick message list.
  - Messages come from this Mac only, with no Slack call, so ⌘K never waits. The same hiding rules apply.
  - The last row on All and Messages is "All results for "…"" with ⌘⇧F. It opens the Search tab with the text and filters.
- The tab title is the query, or "Search" when empty. Privacy mode shows "Search".
- Search state lives outside the mounted page, so Back and Forward, a closed and reopened tab (⌘⇧T) and a restart all bring back the query, the selection and the scroll. The results are fetched again.

### 2. The field across the top, results on the left, the conversation on the right

- **The field and the filter row span the whole tab**, above the split, so long queries and several chips have room. The split starts under them.
- **Results column** 384 px wide, resizable from 312 to 480, like the sidebar. The **reader** takes the rest.
- Up and Down move through the results, and the reader follows at once (it reads from the local store, within the 50 ms cached topic budget). Moving the selection never opens a tab or adds a history entry.
- **Enter** opens the topic at the message in the current tab, with Back returning to the search exactly as it was. **⌘Enter** or ⌘-click opens it in a new tab in the background, and focus stays in the list, so you can open several in a row.
- **The reader is the topic itself**, with its composer, reactions and message menus, scrolled to the match with the matched words marked. You can reply without leaving the search. Its header has the title, the place, **Open in new tab** and the topic's ⋯ menu. When a thread has several matches, "2 of 5" with up and down arrows (⌘↑ ⌘↓) step between them, counted in the thread's reading order (oldest first), whatever the list's sort.
- **Reading marks read only when you act.** Arrowing past a result marks nothing read, as a peek. Clicking or typing in the reader, reacting, sending, or opening the topic marks it read, as opening it does today.
- Tab moves focus from the list into the reader's composer; Esc in an empty composer goes back to the list.
- Narrower than 312 + 480 px: one column. Enter shows the reader with "Back to results"; Esc does the same.
- At the smallest widths the filter row wraps its two toggles to a second line, and under 480 px the reader's header keeps Back, the place icon, the title, the match arrows and ⋯; Open in new tab, Resolve and Juno move into ⋯.
- The sidebar's magnifier shows the current state while a Search tab is active, as Home and All topics do.

### 3. Rows grouped by thread

- A thread's matches sit under one topic line: its art, its Juno title, its place, the time of the newest match. Under it are up to 2 match lines (sender, snippet with the matched words in semibold, time), then "3 more in this thread".
- A channel's Main is not one conversation, so Main matches are single rows with the channel and date. Consecutive Main rows from the same channel share one header line.
- A snippet starts a few words before the first match, with a leading "…" when cut, so the matched words are always visible.
- Grouping uses thread identity only, never a model's sense of similarity. Similar bot messages are not merged: two alerts can be two incidents.
- **Topic titles match too.** Juno's titles are AI-made, so "staging bill" can find the topic titled "Staging bill doubled since August" even when nobody wrote those words. A topic whose title matches shows as a topic line with the words marked, even without a message match. Slack can't do this. Title matches obey `in:` and dates; with `from:`, only topics that person wrote in.

### 4. The query: typed operators and chips are one thing

- One `SearchQuery` object, shared by the Search tab, ⌘K and the Juno agent's search tool. One parser, and two compilers: to SQL for the local index, and to Slack's modifier syntax.
- Operators: `from:`, `in:`, `with:`, `before:`, `after:`, `on:`, `during:`, `has:` (link, file, reaction, pin), `is:thread`, quoted phrases, `-` to exclude, `word*`. Juno adds `is:resolved`, `is:unresolved`, `is:pinned` and `in:` a sidebar view (v2), which Slack has no idea of.
- Typing `from:` or `in:` opens a picker, searched as ⌘K's Conversations tab is. The pick becomes a chip in the field. Clicking a chip edits it; Backspace at its edge removes it. Dates offer Today, Yesterday, This week, Last week, This month and a date.
- Under the field, a quiet row of filter buttons for the mouse: **From**, **In**, **Date**, **Has**, then the sort, and at the end the **Apps hidden** and **Automated hidden** toggles (see 6).
- An operator that can't be answered locally (`with:`, `is:saved`) searches Slack only and says so, rather than show wrong local rows.

### 5. Instant first, then complete, without rows jumping

- Local results paint on every keystroke (100 ms budget). Slack is asked after a 400 ms pause or at once on Enter, 50 per page, newest first.
- **One list, newest first, with a line where it stops being complete.** The local store holds about the last 7 days, plus older topics you've opened. Rows newer than what both sources have covered are complete. Older local rows sit under one quiet line, "Older matches on this Mac", and move up as Slack's pages reach them. Nothing above the line reorders. Rows that arrive above what you're reading keep your place, as the topic view does.
- More pages load as you near the end, one request at a time. A Slack answer for an old query is dropped.
- The states are different and say so: searching, no matches, Slack unavailable ("Showing matches on this Mac. Slack search didn't answer." with Try again), and offline.
- Sort: **Newest** and **Oldest**. **Best match** waits until we verify, read-only, that the internal endpoint honours a score sort. We won't label an unknown order as relevance.

### 6. Apps, bots and automated channels are hidden by default

- Two toggles at the end of the filter row, each remembered: **Apps hidden** (messages from apps and bots) and **Automated hidden** (the conversations in the Automated view, SPEC 5). One click shows them; the label then reads **Apps shown** or **Automated shown**. Nothing is hidden without a visible toggle saying so.
- Apps maps to `search_exclude_bots` on Slack and the bot flag locally, once a live check shows both agree.
- Automated is Juno's own list, so Slack can't filter it: Slack's rows from those conversations are dropped after they arrive, and paging asks for more when a page thins out. Locally it is a `NOT IN` on the channel.
- When a search finds nothing but hidden rows would match, the empty state says so: "4 matches, all from apps and automated channels." with **Show 4 matches**.
- An `in:` chip naming an automated channel searches it whatever the toggle says.

### 7. AI, quietly

Each of these never delays a result, never applies itself, and is gone when AI assist is off.

- **Words to filters.** "maya's messages about the vendor contract last week" searches the plain words at once. After a pause, the suggestion appears inside the field at its right end: "from: Maya Chen · Last week · vendor contract", with Tab to apply. It sits in the field so its arrival moves nothing below; when the text is too long to leave room, it is left out. It uses the existing command parse task (decision tier, cached by text), and only runs when the text names a person, a channel or a time.
- **Answer from results.** When the query reads like a question ("when did we move the cutover?"), the empty reader shows one button, **Answer from results**. The answer appears in the reader, at most a few sentences, each claim followed by a small number; the cited rows carry the same number, and a number selects its row. It reads the matched threads, not just snippets, and says "No answer in these results" rather than guess. It never appears on its own.
- **Summarize** in the reader header for long threads (over about 20 messages), on request, with citations.
- **Matching AI titles** (section 3) is the quietest AI of all: it is already there.
- **v2: Try other words.** When a search finds little, offer up to 3 other queries you can pick ("vendor contract" → "MSA renewal"). Only the one you pick runs.

Rejected: an answer card above the results, AI reranking, an AI "top hit", merging similar results with a model, auto-summaries on selection, confidence scores, badges for saved searches.

### 8. Empty field

- Recent searches (the last 10, with their filters; × removes one), then a short line on operators.
- A pinned Search tab is a kept search. No new "saved search" object in v1.

## Plan

v1, in order:

1. Read-only live checks of Slack search: identity syntax for `from:`/`in:`, combined and excluded modifiers, date boundaries and time zone, `with:`, score sort, `search_exclude_bots`, page limits, the `filters`/`filter_suggestions` shape. Only counts, timings and redacted shapes are kept.
2. `SearchQuery`, the parser and both compilers. ⌘K and the agent tool move onto it.
3. The `search` place with sessions, the two-pane page, the reader, keys, ⌘⇧F, ⌘F in a topic, the ⌘K handoff.
4. Merge with the completeness line, paging, highlighting, the four states, the Apps and Automated toggles.
5. Thread grouping, Main rows, title matches, stepping between matches.
6. Recent searches; privacy mode.
7. Words to filters; Answer from results; Summarize.

v2: Best match (if verified), facet counts as one-click filters (from Slack's `filters`, once verified), Juno-only filters, Try other words, Files, and a semantic index only if we see many searches that find nothing.

Tests: end-to-end flows against the fake Slack (which needs the extra operators, paging and `search_exclude_bots`), a perf spec for keystroke-to-results and arrow-to-reader, and unit tests only for the parser and compilers.

## Decisions

None. Decided with Tushar (10-24): the reader is not read-only; ⌘F in a topic searches that topic; the field spans the tab above the split; apps and automated channels are hidden by default behind visible toggles; ⌘K stays for fast navigation: All, Conversations and Messages tabs, opening on All, local-only results and a row into the Search tab.
