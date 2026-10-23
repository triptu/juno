# Juno search: round 2 (Fable)

Astra's proposal is stronger on the engine side: one schema-backed `SearchQuery` shared by ⌘K, the tab and the agent, chips as a rendering of query clauses, session-keyed tab identity, honest handling of `with:` and `is:saved`, and the list of live checks before building. I adopt all of that. Mine is stronger on the page itself: denser rows, Juno titles as the grouping line, a reader that is one arrow away, and AI that stays out of the way. Where Astra and I differ, here is where I land.

## 1. Merging local and Slack

Neither. Astra's fixed "On this Mac" section spends the top of the list on rows Slack returns anyway: with a 7-day local window, local and Slack page 1 are mostly the same messages, so the user reads them twice. My time merge has a different hole: local also holds old matches from opened topics, and Slack's pages fill in between those rows over seconds, so the list keeps growing in the middle.

Recommendation: one list, newest first, with a **completeness frontier**. The list is complete down to the oldest time both sources have covered (local's window, extended as Slack pages load). Rows older than that sit under one quiet divider, "Older matches on this Mac", and move above the divider as Slack reaches them. The user reads one timeline and sees where it stops being complete; nothing above the divider reorders. Duplicates key by channel and ts. Rows that would land above the selection use the list's scroll anchoring, as the topic view does; the "N newer" pill is only needed when the selection has moved down, which within 400 ms is rare. Under a Best match sort this merge is wrong, which is one more reason to leave that sort for later (point 4).

## 2. Grouping

Astra is right that a busy channel's Main is not one conversation. Six matches across three months under "#eng · Main" lose the timeline. Threads group under their topic line (Juno title, place, time of the newest match) with up to 2 match lines and "N more in this thread". Main matches are individual rows in the timeline, each with channel and date; consecutive Main rows from the same channel share one header line so the place is not repeated. Grouping uses thread identity only, never similarity.

## 3. The answer to a question

Concede. The research says hallucinated and inconsistent answers are the thing people hate most, and an answer that appears on its own runs a model call on every question-shaped query, including quoted ones like "did you see this?". The trigger is Astra's, the placement mine: for a question-shaped query the empty reader pane shows one button, "Answer from results", and the answer appears there with citation chips that select rows. The list never moves. Never without a citation; on failure, "No answer found in these results."

## 4. Sort

Newest first by default, Oldest first too, since it is the same merge reversed. Do not ship Best match until a read-only check shows the internal endpoint honours a score sort. When it does, Astra's layout applies to that sort only: local hits as a small "On this Mac" block, then Slack in server order, because FTS rank and Slack's score are not comparable.

## 5. Row design

Hold my ground, tightened. A manager scans by conversation first and words second, so the title appears once and the matches hang under it. Topic line 28 px, match lines 32 px: sender, snippet with the terms in semibold, time at the end. A thread with 2 matches is 92 px; Astra's 3-line rows take about 128 px for the same two and repeat the title. Main rows are header line plus one match line, header shared by neighbours. Two matches per thread, not three; the reader is one key away.

## 6. Maybe related

Concede, mostly. The internal endpoint already has spell correction and query rewriting, so v1 gets Slack's own loosening for free. Model-widened alternatives have a weakness I underplayed: the model knows "vendor contract" might be "MSA", but not the vendor's name, which lives in the corpus. Ship it in v2 after counting how often committed queries return under 5 hits. When it ships, keep the rules: committed query only, no quotes in the query, labelled section below the exact hits.

## 7. Tab identity

Concede. The user wants to open results in new tabs and compare searches; one Search tab per app makes ⌘⇧F from a topic hijack a search in progress. `Place = { kind: 'search', sessionId }`, equality by session, state outside the mounted component. ⌘⇧F on a Search tab focuses its field; anywhere else it opens a new session in the current tab. ⌘K's "All results" creates a session carrying the text, tokens and the selected match. A pinned Search tab is still a saved search, with no new object.

## 8. What both missed

Keep:
- **⌘F in a topic opens Search with its `in:` chip** (Astra had it; I wrongly deferred). This is the most common Slack search and a one-liner once chips exist.
- **Hide apps and bots by default**, one visible toggle next to the sort, `search_exclude_bots` on Slack and the bot flag locally. Second most common complaint, near zero cost.
- **Next and previous match inside the reader** when a thread has several, buttons in the reader header and ⌘↓ ⌘↑. This is what "no way of seeing the context" asks for.
- **Facets with counts** as one-click chips (top people, channels, dates), v2, only from the server's `filters` and `filter_suggestions` once their shape is verified. Counts from the loaded rows alone would mislead.
- **Juno-only filters** `is:resolved`, `is:unresolved`, `is:pinned`, v2. Juno knows thread state, so it can post-filter Slack rows by their thread_ts. This is a thing Slack cannot do.

Reject: saved searches with new-match counts (badges and polling), AI re-ranking, an AI top hit, file content search, "open all in tabs".

## v1, in order

1. `SearchQuery` schema, parser and compilers to FTS and Slack syntax, shared by ⌘K, the tab and the agent. Tokens with autocomplete in the field; a Filter button for the mouse.
2. The `search` Place with sessions, the two-pane page, the read-only reader that does not mark read, arrows, Enter, ⌘Enter, Back restoring selection and scroll, ⌘⇧F, ⌘F from a topic, ⌘K handoff.
3. Merge with the frontier divider, dedupe, term highlighting through the rich-text model, paging, the four distinct empty and error states, hide bots toggle, stale-response rejection.
4. Thread grouping and Main rows; next and previous match in the reader.
5. Recent searches on the empty field; pinned tab as saved search; privacy mode hides query and snippets.
6. Words to filters: one suggestion line, Tab applies, never self-applied.
7. "Answer from results" for question-shaped queries, in the reader, cited.
8. Live read-only checks first: score sort, `search_exclude_bots`, facet shape, date boundaries and timezone, `with:` semantics, paging drift.

## v2

Best match with Astra's sectioned layout, facets with counts, Maybe related, Juno-only filters, Files scope, boolean OR, and an embedding index only if zero-hit counts justify it.
