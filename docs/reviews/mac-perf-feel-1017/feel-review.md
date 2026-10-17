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

All but the first-sync sidebar one (`sidebar-first-sync`, added earlier) are now in the suite; see the next section.

## The new surfaces' scenarios (10-17 evening)

The `feel-new-surfaces` branch adds 35 scenarios: `reviews` (each review sheet: open, act on a row, close), `sidebar-hold`, `settings` (density), `home` (the Home icon), `chat` (Juno images), `lazy` (each lazy part's first open after a relaunch) and `welcome`. Two new checks: `answersWithin` and `keepsSize`. Every check of the new scenarios was also run on its real run 1 recording with the bug it guards put back (a delayed part, a moved row, an entrance played again, a third state between two), and failed there: 44 of 44.

- Run 1: `89111e14` plus the branch, 10-17 at 22:15 IST, 3.5 minutes, load 3.6 to 5.8. 8 of 19 tests passed; most failures were the suite's own.
- Run 2: 10-17 at 22:28, 4.5 minutes, load 3.3 to 6.1. 11 of 19 tests passed, 32 of 41 scenarios (`juno-image-send` did not record: the attach step before it timed out). The fixes for the image chip and the Home row press came after this build, so no feel run has recorded them yet.

| What a person sees | Scenario, frames | Check | Cause | State |
| --- | --- | --- | --- | --- |
| An image dropped on the Juno composer shows as a file chip ("chart.png 5 KB", 132 px wide), then shrinks to an empty 44 px square, then the picture | `juno-image-attach` #5 to #11, #12, #13 (run 1) | `the chip lands and stays`, `the chip shows its picture in its first frame` | The chip had no preview until the file was read and re-encoded (`readForJuno`); a first fix with an object URL was blocked by the page's CSP (no `blob:` in `img-src`, run 2) | Fixed: a chip-sized copy is made and decoded before the chip is added. Recorded on `feel-followups`: a 44 px square with its picture from #11 |
| Holding the mouse down on a Home row, or on a review card, shows nothing until release | `review-*-open` #3 to #7 (run 1 and 2) | `the card press shows in the next frame` | Home's rows had no press style; then a plain `:active` lost to the hover's doubled class (`.x.x:hover`) | Fixed: `:active` nested under `@media (hover: hover)` like the hover; recorded on `feel-followups`: the press shows in the first frame after it (`review-*-open` #4). `SuggestionChip` had the same bug; the StyleX skill's example had it too |
| Move back on Automated's record puts `#ci-builds` in All behind the open sheet, and the sidebar rows below it drop 60 px | `review-automated-act` #10 (run 1), #11 (run 2) | `no layout shift` (score 0.0124) | By design the channel goes back to All at once; the sidebar does not hold its order while a sheet is open | Fixed on `feel-followups`: the sidebar holds behind any sheet and applies the changes when it closes (SPEC 5) |
| After Enter on a reply typed into Main, nothing changes for two frames, then the check bar shows | `lazy-send-check` #5 to #7 | Seen in the filmstrip; the bar's `answers within 3 frames` passes | The bar waits for the engine's check of the draft (`checkMessage`), not for its chunk | Minor |
| Home's syncing count reports a layout shift with the same box before and after | `home-first-sync` #14, `welcome-appear` #10 (run 1) | `no layout shift` (score 0.0000) | A text change inside the fixed-width count | Fixed on `feel-followups`: an entry whose every box stayed does not count |

Suite problems found and fixed: a `boxes` probe reads `[]` before its element exists, so the review sheets' rows needed `where: sheet shown`; the density radio acts on the press, so its switch check now reads the whole recording; the link editor's check named a count probe as its text; a probe tagged in one topic was read in another; the send check probed the field's box, which grows upwards to hold the bar, in place of the textarea; the sync card leaves by design when the first sync ends.

The switcher's rows now lead with the topic's art (`TopicSwitcher`), as Home's topic list does.
