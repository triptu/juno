# Feel review: the 10-17 UI changes on the Mac

## The run

- First run: `bb4fcb71`, 10-17 at 19:00 IST, 5.6 minutes, load 5.5 to 11.3 per scenario. 16 of 18 passed.
- After: the `mac-perf-feel` branch on `551bf0b8`, 10-17 at 20:37, 3.6 minutes, load 4 to 6. 17 of 18 passed. The one failure is the Home syncing line below.
- Frames named below are from the first run unless marked. The frames are in `feel/`.

## Findings

| What a person sees | Scenario, frames | Check | Cause | State |
| --- | --- | --- | --- | --- |
| The Juno tab shows its empty chat whole, then blanks it and plays the entrance from nothing | `juno-chat-open` #7 to #8, then #15 to #46 | Seen in the filmstrip; the new `stays drawn once shown` check fails on it | The chat rendered before the agent state was known, without the entrance; once the agent came up, `enterEmpty` turned true and the entrance started over drawn content | Fixed: `EmptyChat` decides the entrance when it mounts |
| ⌘K opens with only its search field, then grows to its rows a frame later | `palette-open` #4 to #5 | lands and stays | Nothing kept the Frequent query subscribed, so its first answer came after the first frame | Fixed: `Palette.tsx` subscribes on idle |
| Typing in Home's destination list drops the Juno row a frame before the new rows arrive, and the list's top drops 35 px | `home-write-list-typing` #5 to #7 | Seen in the filmstrip; the new `held rows keep their first row` check fails on it | The Juno row followed the typed text while the rows were still the earlier query's | Fixed: `ConversationList` keeps the first row on the text its rows belong to |
| During the first sync, `#alerts-prod` and `#deploys` show in All, then leave one at a time; every row below jumps about 60 px | `home-first-sync` #18 to #28 | Seen in the filmstrip (the scenario checks Home's rows, not the sidebar's) | `automatedView.ts` sorts a clear bot channel into Automated as its history is stored, "so a clear bot channel leaves All soon after its first messages show". The performance skill's "Delayed data" says an empty cache's first list waits for Automated classification. The code and the doc disagree | Open: the owner decides which is right |
| Home's syncing line moves its first word when "Syncing with Slack." becomes "Syncing 0 of 11 conversations." | `home-first-sync` #20 (after run) | no layout shift (score 0.0005) | The line is centred, so the longer copy starts further left (`c945da27`) | Open: left as a failing check, not loosened |
| The destination chip is an empty pill for one frame when a destination is chosen | `home-write-recent` #8 | Seen in the filmstrip | The new name's rise starts at opacity 0 (`DestinationPickers.tsx`, `rise`), by design | Minor |
| Avatars show a one-letter placeholder, then the photo | `palette-open` #5 to #8, `open-at-bottom` #8 to #13, `press-row` #7 to #10 and others | Seen in the filmstrip | The fake's avatar images draw two initials, so the swap looks larger than with a photo. Images arrive after the rows | Minor |
| After the first sync's send, a row "first" is put at the top of the sidebar, then the confirmed `#eng` row is put above it | `home-write-send` #5 to #8 | Seen in the filmstrip | The pending row, then the stored Main row | Minor |
| A remounted topic shows its loaded images as empty boxes, then fades them in | `tab-switch-restored` #5 to #9 | Seen in the filmstrip | Images are not kept decoded across the remount | Minor |
| A sidebar preview change reports a layout shift with no movement | `live-reply-scrolled-up` #10 | warn | A text change gives a layout-shift entry with the same box before and after | Suite: shown as a warning |

Two scenarios did not run as written (suite problems, fixed):

- `reaction-at-bottom` needs more than 200 px to scroll. With Compact the default (`5c10713c`), eight replies left 165 px. It now sends fourteen.
- `home-first-sync`'s precondition expected "Syncing with Slack."; since `c945da27` the line shows the count.

## Missing scenarios

- Tidy up: open the sheet from Home, act on a row, and check the sheet opens whole and its rows never move.
- Sidebar order hold: a reply lands in another conversation while the pointer is over the list, and nothing in view moves until the pointer leaves.
- Juno images: send an image to Juno, and check the bubble keeps its box while the image loads.
- Compact and Comfortable: switch density in Settings, and check the open topic keeps the row at the top of the view.
- Home's title bar icon: press it from a topic, and check the press shows in the next frame and Home replaces the topic once.
- Lazy parts: open each lazy part (send check bar, peek, suggestions, sync cards, edit field, link editor) first thing after launch, and check it opens whole.
- The welcome card: open and dismiss it, and check Home's rows do not move.
- First sync sidebar: record the sidebar, not only Home, through a held history, and check painted rows never leave or move.
