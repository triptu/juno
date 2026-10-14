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

The caught-up state uses A with no items: the sunk-back scene, "All caught up.", one line of reason, the ask field, and a quiet "Browse all topics" link as the next step (SPEC §16: empty states say why and offer one step).

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

| Items | Text |
| --- | --- |
| 1 | One thing wants you. |
| 2 | Two things want you. |
| 3 | Three things want you. |
| 0, caught up | Nothing is waiting on you. |
| 0, but unread exists | Nothing is waiting on you. Nothing new since yesterday either. |

### Item templates

Each item has a title line (13.5px, medium) and a meta line (12.5px, muted): the topic title, then the channel, then a time or a count. The title line is the template; the meta line is always plain data.

| Kind | Rule (AI off) | Title, AI off | Title, AI on (example) |
| --- | --- | --- | --- |
| Waiting on you | A message in a followed thread or DM that mentions you and ends in a question mark, with no reply from you after it | `<Name> asked you something` | `Elena wants a call on Rina's competing offer by Friday` |
| Pick up where you left off | The last topic you had open for more than a minute, if it has new messages since | `Pick up where you left off` | `Pick up where you left off: Dev wants the Postgres 16 cutover window` |
| Moved a lot | A followed topic with the most new messages since you last opened it, at least 8 | `Moved a lot since you looked` | `Maya's proposal grew 14 replies, leaning toward cutting offline mode` |
| Follow-up (AI on only) | Something you said you would do, found by the assistant in your own messages; Mark done clears it | not shown | `You said you'd send Rina the scorecard` |
| Tidy up (AI on only) | Topics the settled decision scored high, at least two | not shown | `3 topics look settled`, with Resolve all |

AI never adds an item the rules did not find; it only rewrites the title line of an item that is already there, and only when its confidence is high. If the rewrite is missing, late or low confidence, the AI-off title shows. The meta line never changes, so the row's second line is identical with and without AI and nothing shifts when a rewrite arrives.

## Picking a scene

One scene per visit, chosen in this order. The first rule that matches wins.

1. **Caught up.** No items and no unread in followed topics: the sunk-back scene. Always, regardless of the time.
2. **Seasonal, rare.** On the first visit of a day inside a season window, one in six: `winter` (1 Dec to 31 Jan) or `autumn` (15 Sep to 15 Nov). Never twice in a row, never at night.
3. **Friday.** Friday, 5:00 to 21:59: the plant.
4. **Time of day.** 5:00 to 10:59 morning (coffee), 11:00 to 16:59 midday (at the laptop, sun high), 17:00 to 21:59 evening (leaning back, laptop closed, sun down), 22:00 to 4:59 late night (a moon).

The scene is chosen when the home mounts and stays until the tab changes; it does not tick over while you look at it. Local time, from the system.

The eight scenes in `scenes.png`: morning, midday, evening, late night, Friday, winter, autumn, all caught up. They share one figure (the logo's seated j: head r7, spine stroke 8.5), three postures (upright, leaning, sunk back), the logo's laptop as two dots (open: one dot on the table and one up; closed: both on the table), a mug, and props at stroke 4 with round caps. One flat layer in `--warm-soft` per scene (the sun, the moon, the mug, the pot, the leaf, the cushion). Everything else is `currentColor` in `--foreground-subtle`, so one drawing serves both themes.

## Items: how they are chosen and capped

- Candidates come from the local cache only: followed topics, read state, the last-opened log and mentions. No network call, no AI call, before first paint.
- Rank: waiting on you first, then pick up where you left off, then moved a lot, then follow-ups, then tidy up. At most one of each kind; tidy up is one row for several topics.
- Cap at three. If the window is shorter than 600px, cap at two.
- Each item is one topic, except tidy up. A topic appears once; if it qualifies for two kinds, the higher kind wins.
- Opening an item opens the topic in the current tab like any row, with ⌘-click for a new tab. Opening it marks it read under the normal rule, so it leaves the list on the next visit.
- Resolved, unfollowed and muted topics never appear.
- Items do not refresh while the home is on screen. They are computed at mount, and recomputed on the next mount, so a row never disappears under the pointer.

## Accessibility

- The scene is decorative: `aria-hidden`, no title. The greeting carries the meaning.
- The greeting is an `h2` so a screen reader lands on it; the second line is a paragraph.
- Items are real links (`a` with an href to the topic), in a list, focusable in order, with the hover highlight also shown on focus. The caret appears on hover and focus only.
- The ask field is a button labelled "Ask Juno" that opens the Juno chat; it is not an input, so there is no second composer on the page. ⌘J does the same.
- Text meets 4.5:1 in both themes: the title line is `--foreground-default`, the meta line `--foreground-muted` on `--background` (4.93:1 light, 6.6:1 dark).
- The entrance respects `prefers-reduced-motion`: the four parts rise 6px over 240ms, 80ms apart, and under reduced motion they simply appear.

## Performance

- The scenes are inline SVG symbols in the bundle, about 4 KB for all eight. Nothing is fetched. The first paint has the scene, the greeting and the items; there is no loading state and no spinner.
- The layout is fixed before data arrives: the scene box is 120 by 83, the greeting is one line, the items column has a fixed width and each row is 52px. A row that arrives late is not allowed; items are read synchronously from the cache at mount, so the page never reflows.
- The AI rewrite of an item's title is the only thing that can arrive after paint. It replaces the text of a one-line, ellipsised title, so the row height does not change.
- No timers. The scene and greeting do not update on the minute.

## With AI off

Everything on the page works with AI off, which is also the first-paint state with AI on:

- the scene and greeting come from the clock and the item count;
- the items come from the four rules above with their fixed titles;
- the ask field opens the Juno chat, which with AI off shows its own "AI is off" state.

AI on changes only the title line of items and may add the follow-up kind. No AI label appears on the home; the sparkle on the ask field is the Juno mark, not an AI-content marker.
