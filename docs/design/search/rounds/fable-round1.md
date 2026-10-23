# Juno search: design round 1 (Fable)

## 1. The strongest ideas

1. **A Search tab with a reader pane.** Results on the left, the selected result's topic on the right, open at the matched message. Arrow keys walk the results and the reader follows. Nothing is lost by looking. For a manager, "which of these eight hits is the one I mean?" is answered by reading, not by opening and coming back. Cost: a new `search` Place, a two-pane page, a reusable read-only topic body (the peek has one). Risk: the reader must open within the 50 ms budget, or arrowing feels sticky.
2. **Results grouped by topic, with Juno's titles.** Slack shows six hits of one thread as six rows. Juno shows one topic row, with its AI title and place, and its matches under it. Titles are screen-share safe already; snippets blur in privacy mode. Cost: a client-side reduce. Risk: late pages add matches to earlier groups (rule below).
3. **Filters as tokens in the field, with autocomplete.** Type `from:` or `in:` and a picker opens; the choice becomes a token, as in Mail's search field. Tokens are editable in place and Backspace removes one. Slack operator parity rides on the same tokens. Cost: a token field primitive and a parser shared with ⌘K.
4. **Instant local, Slack layered in, never a jump.** Local FTS paints under 100 ms. Slack's answer lands 300 to 540 ms later and is merged by time, below what the user has already moved to. One list, not "local" and "Slack" sections.
5. **Plain words become filters, one Tab away.** "messages from maya about the vendor contract last week" runs at once as literal words, and a line under the field offers "from: Maya Chen · after: Oct 13 · vendor contract" to apply with Tab. Nobody remembers operators.
6. **A question gets an answer in the reader, with citations.** When the query is a question, the empty reader pane holds a short answer whose citations are the result rows. The list never moves to make room for it.
7. **"Maybe related" for vague memory.** When exact matches are few, a model widens the terms ("vendor contract" → MSA, SOW, the vendor's name) and a labelled section of up to 5 rows follows the exact ones. No embedding index needed.
8. **A pinned search tab is a saved search.** No new object, no new sidebar section.

## 2. The Search tab

**Opening it.** ⌘⇧F opens a Search tab in the current tab, or focuses one that is already open, as pages do (SPEC 6). ⌘K's Messages tab gets a fixed footer row under its list: "All results for “vendor contract” ⌘⇧F". Clicking it, pressing ⌘⇧F while the palette is open, or Enter when the palette shows "No matches." opens the Search tab with the text, and any tokens the parser read, carried over. ⌘K stays the quick path; the tab is for reading.

**Layout.** Two panes inside the tab. The results pane is 384 wide, resizable between 312 and 480 like the sidebar, with the same 10px inset. The reader takes the rest. When the workspace is narrower than the results pane plus 480, the reader goes and the page is one column; Enter then opens the topic in place and Back returns. The tab's icon is `magnifying-glass`; its title is the query, or "Search" when empty, and "Search" in privacy mode.

**The field.** At the top of the results pane, 34 high, the search icon, then tokens and text inline, placeholder "Search messages". Tokens: `from:`, `in:`, `with:`, `has:`, `before:`, `after:`, `on:`, `during:`, `is:`, quoted phrases, `-word`. Typing an operator opens the picker under the field, searched as ⌘K's Conversations tab is; dates offer "today, yesterday, this week, last week, this month, a date". A click on a token reopens its picker; Backspace at its edge removes it. A quiet Filter button at the field's end lists the operators for the mouse. One parsed query feeds both: local FTS gets words and constraints, Slack gets its operator string.

**Under the field.** One 28px row: a `Segmented` scope, **Messages** · **Files** (Files is a later milestone; the control starts with Messages alone), and at the end a sort `Select`: "Newest first | Oldest first | Best match". Best match is Slack's order, so it is third. When the query names a person or channel outright, one jump chip sits between them: "Maya Chen · Direct message".

**A result.** Rows are grouped by topic, newest matched message first.
- Topic line, 36 high: art 20, title 14/500 with an ellipsis, place 12.5 muted ("#eng", "Maya Chen · Main"), time of the newest match at the end.
- Match lines under it, 36 high each, indented to the title: sender 12.5 subtle, then the snippet 13 with the matched terms in semibold (the ⌘K convention), one line with an ellipsis, its time at the end. Up to 3 per topic; "4 more in this topic" is a quiet line that expands in place.
- Bot messages with the same text in one channel collapse to one line: "12 alike from Datadog".
- Selection is per match line, `--surface-hover`, a roving tabindex. ↑ and ↓ move through match lines and skip topic lines; the reader follows each move. ↑ from the first match returns to the field with its text selected. Enter opens the topic at that message in the current tab, which pushes a history entry, so Back returns to the search with its selection and scroll. ⌘Enter opens in a new tab and keeps focus in the list. Esc in the list focuses the field.

**The reader.** The topic's read-only body in compact rows, as the peek popover draws it, scrolled to the matched message with the existing flash and the terms in semibold. Header: the topic's title, place, and two buttons, **Open** (Enter) and **Open in new tab**, plus the ⋯ menu. Reading here does not mark anything read; opening does. ⌘J opens the Juno panel on that topic, where "summarize" already lives. No composer: a reply is one Enter away.

**Loading and merging.** Local FTS runs on every keystroke, no debounce. Slack runs after a 400 ms pause, 20 per page. Rules:
- Never reorder a row already shown. Slack's rows are deduped by channel and ts, then merged by time. Rows that would land above the selection are held behind a pill at the top, "8 newer results"; with the selection still on the first row the merge is in place.
- A late match for an existing group raises its "N more" count and nothing else.
- While Slack works, the last row is "Looking through older messages…" in muted text, replaced in place. No spinner.
- Paging: the next page is asked for when the last row is within 1,000 px, one in flight, in both sources. Slack's total shows as "About 2,043 results" in the list header.
- Offline or a Slack error: the local rows stand, and the footer line reads "Older messages need a connection" with Retry.
- An old Slack answer never replaces a newer query's rows.

**State.** The `search` Place holds the text, tokens, scope, sort, selected match and scroll. Back, Forward, ⌘⇧T and the saved tabs restore it. An empty field shows **Recent searches** (the last 10, text and tokens, stored locally; a trailing × removes one) and nothing else. Pin the tab to keep a search.

**Empty states.** Empty field: recent searches, else "Search your messages. Narrow with from:, in: or a date." No results: "Nothing matches “x”. Try fewer words, or remove a filter." with Clear filters when there are tokens. The text waits for Slack's answer.

## 3. AI, quietly

**Words to filters.** Runs the 150 ms command parse already in ⌘K (a decision task, cached by exact text), only when the text has a cue: a known person or channel name outside quotes, a time phrase, "from", "in", "with", "about". Shows one line under the field: "from: Maya Chen · after: Oct 13 · vendor contract · Tab" with the sparkle badge ⌘K uses. Tab applies, anything else ignores it. Results never wait for it; below the threshold or on failure the line is absent. Cost: one decision call per pause. A wrong parse is noise, so the bar is high and it never applies itself.

**An answer to a question.** Only when the query ends in "?" or starts with a question word, decided by a rule, not a model, and only once results exist. The reader pane, empty until a result is selected, shows "Juno is reading…" then an answer of at most three sentences, each claim followed by a citation chip naming a result; a chip selects that row. The list never moves. Deadline 8 s; on failure the pane says "No answer found; the results are below", then goes blank on the next move. Moving the selection shows the topic; "Answer" in the reader header brings it back. Never without a citation. Cost: one generate call over the top 20 snippets, cached by query. Gimmick risk: medium. It earns its place on "did we agree on the launch date?" and nowhere else.

**Summaries in the reader.** On demand only, through the existing ⌘J panel. No auto-summary on selection: a call per arrow press, and noise on short threads.

**Grouping and dedupe.** Rules only (topic grouping, identical bot text). A model here is slower, costlier and less predictable than the rule.

**Maybe related.** When the exact query has two or more words and fewer than 5 matches, a generate call (deadline 3 s) proposes up to 3 alternative queries; each runs on Slack and the union, minus exact hits, shows as a "Maybe related" section of up to 5 rows after the exact results, with the alternative words that found each row in muted text. Absent on failure or when exact results are plenty. Cost: one generate call and up to 3 Slack calls, on a pause, never per keystroke. This is the one thing Slack cannot do and the most likely to look silly; the label and the position below keep a wrong guess cheap. An embedding index is the better version, deferred.

## 4. Cut, defer, and the lines not to cross

- Defer: the Files scope (has:file covers the common case), People and channels scope (⌘K does it), a saved-search object (pinned tabs), the embedding index, "search this channel" from a topic header (a later one-liner: a Search tab with `in:` set).
- Cut: AI re-ranking of results, auto-summaries, AI-chosen "top result", an answer card above the list, counts or badges on the Search tab, a "smart" toggle. Each is slow, moves rows, or shouts.
- Principle lines: AI never applies a filter by itself; AI never delays a row; the answer never writes or sends; nothing in the list is a model's choice except the labelled related section; no `cursor: pointer` anywhere in the page; tab title hides the query in privacy mode; no vim keys, since the rest of Juno uses arrows.

## 5. Questions for Tushar

1. **Read-only reader, or the full topic with a composer?** Recommend read-only; Enter is one key, and a composer in the reader would mark read and steal focus from the list.
2. **Default sort newest first, or Slack's best match?** Recommend newest first: it merges the two sources without jumps, and the related section and tokens carry relevance.
3. **Does reading in the reader mark the topic read?** Recommend no, like a peek. Opening does.
4. **⌘⇧F for the Search tab, leaving ⌘F for a future find-in-topic?** Recommend yes.
5. **Files scope in the first milestone?** Recommend no; `has:file` and a later Files segment.
6. **Answer in the reader pane, or above the list?** Recommend the reader: the list never moves and the answer gets the room it needs.
