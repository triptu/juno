# Research summary: Slack search, likes and dislikes (2026-10-23)

## Complaints (sourced, mostly HN 2024-2025)
- Needs the exact words; synonyms fail. "Unless you know the exact wording ... easier to scroll back" (HN 2025).
- Bots and alert channels crowd relevance results; "Hide apps and bots" is buried.
- Old decisions get lost ("the answer is in Slack somewhere 5 months ago").
- Free plan: only 90 days searchable; data over 1 year deleted (since Aug 2024).
- Slow; scrolling to a match's context is "repeated scroll and wait".
- Threads tedious; hard to re-find a thread you looked at before.
- No boolean AND/OR; only quotes, -exclude, prefix*.
- Teams (comparable): finds the message but "no way of seeing the context".
- Defenders: quotes give exact search; search is "a super power" for finding why a decision was made.

## What Slack has (2025-26)
- Modifiers: "phrase", -word, rep*, in:#ch / in:@person, from:@x, with:@x, has::emoji:, has:pin, has:link/file, is:saved, is:thread, before:/after:/on:/during:, -in:/-from:.
- Desktop: search field with suggestions; Enter opens full results view; result types Messages/Files/People/Channels/Canvases; Filters button and quick chips (From, In, Date, File type); "Search details" shows applied filters; sort relevance or most recent; recent searches; ⌘G global, ⌘F in conversation.
- Slack AI: plain language becomes editable filters (Pro+); AI answers above results with hover-preview citations (Business+); thread summaries; recaps.

## APIs
- Internal `search.modules.messages` params seen in the wild: module, query, page, count, client_req_id, search_session_id, extracts, highlight, max_extract_len, extra_message_data, query_rewrite_disabled, spell_correction, search_exclude_bots, search_only_my_channels, search_context, recent_channels, sort, sort_dir, search_tab_filter, search_tab_sort, facets_result_count, max_filter_suggestions. Response: pagination, filters, manual_filters, ai_filters, filter_suggestions, items grouped by channel. Cap 100 per page x 100 pages. Some tools page with cursor.
- Other modules: search.modules.{files,channels,people,dms}; search.inline (channel, thread_replies, from_me, with_me, max_ts; probably ⌘F in a conversation); search.save (probably recent searches) [unsure].
- Public search.messages no longer returns previous/next context (since 2020) and collapses close matches. Public assistant.search.context has semantic retrieval only for score sort, ~10/min rate limit.

## Comparable tools
- Zulip: channel:, topic:, sender:, dm:, is:resolved, is:followed, has:link|image|attachment|reaction, near:; every filter negatable; typeahead; search URL is a permalink; "go to its topic for full context".
- Linear: @-mention becomes a filter chip; sort relevance/updated/created; recent searches; highlight in titles.
- Gmail: search chips so you need not remember operators; Most relevant / Most recent toggle (some dislike forced relevance).
- Apple Mail: Top Hits first; suggestions become editable tokens (complaint: Top Hits can't be turned off).
- Superhuman: operators + AND/OR; "Ask AI" kept separate from search, answers with citations.
- Mattermost: results pane, Jump in context, Messages and Files separate, date picker for on:.
- Discord: results in a side panel; "Jump" long went to newest instead of the match.

## AI: what works / annoys
- Works: plain language to visible editable filters; cited answers with hover preview.
- Annoys: hallucination (Slack warns retries after "I don't know" hallucinate), inconsistent answers, AI failing to find known content, paywalls, privacy.

## Implications
1. Results list stays beside a context pane; back returns to the same scroll and selection.
2. j/k or arrows move through results while the preview follows; Enter opens the topic; ⌘Enter new tab.
3. Group results by topic, match highlighted with neighbour context.
4. Fetch context ourselves (cache first, else conversations.replies/history).
5. Operators first-class but optional: typed modifiers and chips are two views of one query.
6. Facets with counts (people, channels, date, has file/link).
7. Hide bots by default behind one visible toggle (search_exclude_bots).
8. Relevance/recent switch is one key and remembered.
9. Local cache first, then merge server results.
10. Topic-level search (titles, resolved, in this topic) as Juno's edge.
11. Recent searches; saved searches pinned as views.
12. AI turns plain language into visible filters, never hidden ones.
13. Short cited answer only when the query is a question; quiet; "Not found" rather than guessing.
14. Related words / semantic fallback on zero or weak hits; quotes stay strict.
15. State limits honestly (90-day free plan, partial or failed Slack search).
