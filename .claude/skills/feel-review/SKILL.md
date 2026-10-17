---
name: feel-review
description: The feel review for Juno. Use at each UI milestone review, or when asked whether the app feels stable, to run the feel suite (`pnpm test:feel`), read its contact sheet, filmstrips and videos, and report what shifts, jumps, flickers, flashes empty or answers late, with frame numbers.
---

# Feel review

Juno should feel as stable as a native macOS app: nothing moves unless the user moved it, feedback shows in the next frame, and there is never an empty or wrong frame between two states. The feel suite records scripted interactions against the fake Slack server and checks this frame by frame. Your job is to run it, look at what it recorded, and report what a person would notice.

## Run it

1. `pnpm test:feel` from the repository root. It builds the app, then queues behind the machine-wide lock (`scripts/heavy.mjs`), so it may wait for other agents' runs before it starts. Do not run it twice at once and do not start other heavy jobs alongside it.
2. It writes `apps/desktop/feel-report/`. A failed check fails the run, but every scenario still records.
3. Note the load average printed per scenario. A long frame under heavy load is weak evidence; the geometry and pixel checks count frames, not time, so load does not change them.

## Look at it

- Open `apps/desktop/feel-report/index.html`. Failures come first. Each scenario has its checks with the frame numbers that prove them, a 4× slow-motion video with a frame counter under it, and the filmstrip. Clicking a frame number seeks the video to it.
- `<scenario>/filmstrip.png` is every frame as a labelled tile (`#12 +350 ms`); frames named by a failed check have a red border and the check's name. `<scenario>/frames/0012.jpg` is the full-size frame.
- Read each filmstrip yourself, including the passing ones. The checks cover known failure modes; you are there for the ones they miss: a frame with the wrong content, a skeleton with the wrong size, a scrollbar that jumps, text that reflows, a colour that flashes, an animation that starts from the wrong place.
- Frames come from the compositor, so a frame exists only when something changed. Two frames far apart in time mean nothing moved between them.

## What the checks mean

| Check | Fails when |
| --- | --- |
| lands and stays | an element (the "N new" divider, a popover) moves after its first frame |
| stays at the bottom | a frame of a topic opened at the bottom is more than 2 px off the bottom |
| what is on screen holds still | the row at the top (or bottom) edge of the view moves between two frames while the user is not scrolling |
| scrolling never jumps back | content moves against the wheel while scrolling |
| a painted row stays in All and never moves up, a bot channel never shows in All | during the first sync (`sidebar-first-sync`), a sidebar row leaves All or rises, or a row of a channel the Automated rules move shows in All; rows that land above and push painted rows down only warn, as `no layout shift` |
| no layout shift | the browser reports a `layout-shift` entry that moved a box (shifts within 500 ms of a press are left out where the press replaces the pane; an entry whose every box is where it was, as a text change can give, does not count) |
| shows in the next frame | hover or press feedback is not in the first frame after the event |
| opens whole, opens at its anchor | a popover is empty in its first frame, disappears and comes back, or opens away from its button |
| switches once | a frame shows a third state between the old and the new (a blank pane, the new header over old rows), or goes back |
| first frame is at the saved position | a restored tab paints somewhere else first |
| never blank, does not flicker | a region is one flat colour, or changes and changes back within 100 ms (pixel diffs between frames) |
| stays drawn once shown | an element drawn fully opaque is later drawn fainter: content that fades out or starts an entrance over itself |
| answers within N frames | the part an input opens (a lazy part on its first open, a review row's outcome) shows later than N animation frames after the key or press |
| keeps its size | a box that content loads into (an image's reserved box, a bubble) changes its width or height |
| the held order holds, the new order lands in one step | under the pointer (`sidebar-hold`) a sidebar row moves while replies land, or after the pointer leaves the list goes through another order before the new one |
| no long animation frames | a frame over 100 ms with work of the page in it (blocking time or a script) fails; any other frame over 50 ms warns, since a busy machine makes those too |

Confirm every failed check in the images before reporting it. Each image is stamped with the animation frame it shows (`f12` in the filmstrip label), and the probes read the same frame just before it paints, so they should agree. If a check reports a move that the frames do not show, the images win: report it as a suite problem with both frame numbers.

A precondition check ("the reaction showed", "images arrived after the rows") failing means the scenario did not do what it says, so its other checks prove nothing. Report that as a suite problem, not an app bug.

## Report

Write `docs/reviews/<milestone>/feel-review.md`:

1. The run: commit, date, duration, load, pass and fail counts.
2. Findings, worst first, one table: what a person sees, the scenario, the frame numbers (`open-long-at-divider #14 to #16`), the failed check or "seen in the filmstrip", and the likely cause if the code makes it clear. Copy the frames that show it into `docs/reviews/<milestone>/feel/`.
3. Scenarios that are missing for the milestone's new surfaces, written as one line each (what to record and what to check), so they can be added to `apps/desktop/e2e/feel/`.

Do not fix the app in the review. Do not loosen a check to make the run pass; if a check is wrong, say why and propose the change.
