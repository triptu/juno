# The living home

What the workspace shows when no tab is open, and the Home page that the sidebar's Home item opens as a tab (SPEC §12). Home also took over the For you page's Follow-up and Tidy up items (decision log 10-14 15:30). It replaces the "Nothing open yet" empty state with a small scene of Juno's mascot, a greeting, up to three things computed from the user's data, and an Ask Juno field. The scene changes with the time of day, the weekday, the season and whether anything is waiting.

Files:

- `home.html`: the mock. Open it from this folder (`file://` works, the fonts are copied into `fonts/`). It shows the three layouts and the caught-up state in light and dark, the strip of scenes, and the home in a full window next to the sidebar screenshot from `../screens/`.
- `home-variants-light.png`, `home-variants-dark.png`: the layouts.
- `scenes.png`: every scene at the workspace size in both themes, then the parts the scenes are built from.
- `in-context-light.png`, `in-context-dark.png`: a 1200 by 800 window with the sidebar on the left.
- `render.mjs`: re-renders the PNGs (`node render.mjs` from this folder; one Chromium, one page).

## The variants

**A · Centred.** The scene sits over the greeting, the items run in a narrow column under it, and the ask field closes the column. It is the existing empty state with more in it: same position, same serif title, same illustration size. The eye lands on the scene, then the greeting, then the items.

**B · Scene left.** The scene sits beside the greeting at 150px, the items and the ask field fill the right column. It uses a wide window better and the figure feels like company rather than a header. On a narrow window the two columns get cramped.

**C · Compact page.** Top-left aligned like For you, with a small scene (84px) in the header beside the title. The densest layout; it reads as a page rather than a resting state.

### Recommendation

Ship **A**. It keeps the calm of the current empty state and it is the one layout that still looks right at the minimum window size, with zero items, and with three. B is the better picture at 1400px and up but needs a breakpoint, and C turns a resting place into another list page. If the owner wants the figure larger, A can take the scene at 150px without any other change.

The caught-up state uses A with no items: the sunk-back scene, "All caught up.", one line of reason, and the ask field. It had a quiet "Browse all topics" link; it was removed on 10-17 because All topics is always in the sidebar.

## Copy

Juno's voice (SPEC §17 and friendly-layer §7): sentence case, short, warm, no exclamation marks, no emoji, never jokes. The greeting is two lines: a serif line with the person's first name, and a sans line that says how much is waiting.

### Greeting, first line

| When | Text |
| --- | --- |
| 5:00 to 10:59 | Morning, Tushar. |
| 11:00 to 16:59 | Hello, Tushar. |
| 17:00 to 21:59 | Evening, Tushar. |
| 22:00 to 4:59 | Still up, Tushar. |
| Friday, 5:00 to 21:59 | Happy Friday, Tushar. |
| Caught up (any time) | All caught up. |

The first name comes from the Slack profile. If there is none, drop the name and the comma: "Morning." The late-night line never shows the day; the Friday line replaces the time line, not the scene rule below.

### Greeting, second line

There is none: the rows are the count (SPEC §12). Only the first sync has a second line, "Syncing with Slack." and then its count. Once Home is ready, no rows means caught up, whatever is unread in the sidebar: unread messages that want nothing of you do not make a row.

### No thought

Home shows nothing under the greeting when nothing waits: no quote or fact, during the first sync or after it. The quotes and facts are in the gallery (SPEC §12, "Pictures and the gallery"; `docs/design/home-art/`), from the list in `packages/pictures/src/thoughts.ts`. To add one, check the quote against its primary source (book, essay, speech, letter, with the year; Quote Investigator for anything famous) or the fact against a reference such as a NASA page or an encyclopedia article, and leave it out when in doubt.

### Item templates

Each item has the topic's art (40px; Tidy up has a broom tile), a title line (13.5px, medium) and a meta line (12.5px, muted): the topic title, then the channel, then a time or a count ("14 new"). Tidy up's meta line lists the settled topics' titles. The title line is the template; the meta line is always plain data.

| Kind | Rule (AI off) | Title, AI off | Title, AI on (example) |
| --- | --- | --- | --- |
| Missed huddle | An ended huddle whose participant history excludes you, including an offline or dismissed one | `Missed huddle with Maya` or `Missed huddle in #eng` | Same factual title |
| Waiting on you | An unread message in a followed thread or group DM that mentions you and ends in a question mark, or any unread question in a one-to-one DM, with no message from you after it | `<Name> asked you something` | `Elena wants a call on Rina's competing offer by Friday` |
| Pick up where you left off | The last topic you had open for more than a minute, if it has unread messages | `Pick up where you left off` | `Pick up where you left off: Dev wants the Postgres 16 cutover window` |
| Moved a lot | A followed topic with the most new messages since you last opened it, at least 8 | `Moved a lot since you looked` | `Maya's proposal grew 14 replies, leaning toward cutting offline mode` |
| Follow-up (AI on only) | Something you said you would do, found by the assistant in your own messages; Mark done clears it | not shown | `You said you'd send Rina the scorecard` |
| Automated | The newest channel neither the rules nor Juno could place in the Automated view (SPEC §5 "Automated"); a robot tile, and the meta line says how many of its latest messages came from apps | `Move #releases to Automated?`, with Keep in All and Move | the same |
| Tidy up (AI on only) | Topics the settled decision scored high, at least two | not shown | `3 topics look settled`, with Resolve all |

AI never adds an item the rules did not find; it only rewrites the title line of an item that is already there, and only when its confidence is high. If the rewrite is missing, late or low confidence, the AI-off title shows. The meta line never changes, so the row's second line is identical with and without AI and nothing shifts when a rewrite arrives.

## Picking a scene

One scene per visit, chosen in this order. The first rule that matches wins.

1. **Caught up.** No items and no unread in followed topics: the sunk-back scene. Always, regardless of the time. When a picture is on this Mac and pictures are on, the picture takes the scene's place (`../home-art/`).
2. **Seasonal, rare.** On the first visit of a day inside a season window, one in six: `winter` (1 Dec to 31 Jan) or `autumn` (15 Sep to 15 Nov). Never twice in a row, never at night.
3. **Friday.** Friday, 5:00 to 21:59: the plant.
4. **Time of day.** 5:00 to 10:59 morning (coffee), 11:00 to 16:59 midday (at the laptop, sun high), 17:00 to 21:59 evening (leaning back, laptop closed, sun down), 22:00 to 4:59 late night (a moon).

The scene is chosen when the home mounts and stays until the tab changes; it does not tick over while you look at it. Local time, from the system.

The eight scenes in `scenes.png`: morning, midday, evening, late night, Friday, winter, autumn, all caught up. They share one figure (the logo's seated j: head r7, spine stroke 8.5), three postures (upright, leaning, sunk back), the logo's laptop as two dots (open: one dot on the table and one up; closed: both on the table), a mug, and props at stroke 4 with round caps. One flat layer in `--warm-soft` per scene (the sun, the moon, the mug, the pot, the leaf, the cushion). Everything else is `currentColor` in `--foreground-subtle`, so one drawing serves both themes.

## Items: how they are chosen and capped

Missed huddles rank after mentions. At most one appears, within the three-row cap. Opening the row opens its conversation and clears it; joining a later huddle there clears older misses. Unseen misses expire seven days after ending. Ignored channels count, with the incoming huddle’s Every message and Never precedence.

- Candidates come from the local cache only: followed topics, read state, the last-opened log and mentions. No network call, no AI call, before first paint.
- Rank: waiting on you first, then mentions in ignored channels, then missed huddles, then pick up where you left off, then moved a lot, then follow-ups, then Automated, then tidy up, then follow-ups that look done and old drafts (SPEC §12). At most one of each kind; tidy up is one row for several topics. "Followed" is a thread Slack follows or a DM; a channel's Main is a stream, not a followed topic, so it never shows as Moved a lot.
- Cap at three. If the window is shorter than 600px, cap at two.
- Each item is one topic, except tidy up. A topic appears once; if it qualifies for two kinds, the higher kind wins.
- Opening an item opens the topic in the current tab like any row, with ⌘-click for a new tab. Opening it marks it read under the normal rule, so it leaves the list at once.
- Resolved, unfollowed and muted topics do not supply message rows. Missed huddles use the conversation regardless of its followed or resolved state, with the notification rules above.
- Items are live (SPEC §12, "Home is live"). Your own action on a row removes or changes it at once; the rows below move up and the next item takes the free place. Changes from elsewhere show while Home is on screen, except while the pointer or keyboard focus is in the rows or a review sheet is open, when the rows hold as the sidebar does and the waiting changes apply in one step when the hold ends.

## Accessibility

- The scene is decorative: `aria-hidden`, no title. The greeting carries the meaning.
- The greeting is an `h2` so a screen reader lands on it; the second line is a paragraph, read after the greeting.
- Items are real links (`a` with an href to the topic), in a list, focusable in order, with the hover highlight also shown on focus. The caret appears on hover and focus only.
- The ask field is a button labelled "Ask Juno" that opens the Juno chat; it is not an input, so there is no second composer on the page. ⌘J does the same.
- Text meets 4.5:1 in both themes: the title line is `--foreground-default`, the meta line `--foreground-muted` on `--background` (4.93:1 light, 6.6:1 dark).
- Home never animates. The scene, the greeting, the rows and the welcome card are drawn in their final state in the frame Home first shows, so there is nothing to reduce for reduced motion.

## Performance

- The scenes are inline SVG symbols in the bundle, about 4 KB for all eight. Nothing is fetched. The first paint has the scene, the greeting and the items; there is no loading state and no spinner.
- The scene box is 120 by 83, the greeting is one line, the items column has a fixed width and each row is at least 52px. No space is kept for rows that may come: a row that comes or goes moves the column, as the SPEC allows (density over zero shift). Home paints whole when `home.view` (a local query) answers. Opening it from a topic keeps the topic on screen while the local result arrives, for at most 150 ms, as All topics does. Until the first sync has finished (first launch on a real workspace takes minutes), Home shows the scene and the greeting with "Syncing with Slack." in place of the count line; it never says "All caught up" too early. Rows show in rank order as conversations land, held like any other change while the pointer is in them. Before `home.view` answers at all (milliseconds) the page is blank.
- The AI rewrite of an item's title replaces the text of a one-line, ellipsised title, so the row height does not change, and it applies even while the rows hold.
- No timers. The scene and greeting do not update on the minute.

## With AI off

Everything on the page works with AI off, which is also the first-paint state with AI on:

- the scene and greeting come from the clock and the item count;
- the items come from the four rules above with their fixed titles;
- the ask field opens the Juno chat, which with AI off shows its own "AI is off" state.

AI on changes only the title line of items and may add the follow-up kind. No AI label appears on the home; the sparkle on the ask field is the Juno mark, not an AI-content marker.
