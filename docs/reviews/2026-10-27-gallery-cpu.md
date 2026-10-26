# Gallery CPU in the full run, 2026-10-27

The goal was to cut the CPU of the gallery job when it walks every state uncached (all full runs at the time; since `225c73906` the weekly or `--no-cache` full run, affected runs and changes that re-key many states) without checking fewer states, elements, actions or snapshots. All runs use the laptop, three physical cores (six threads), six workers, zero retries, `GALLERY_SHIFT_ALL=1 GALLERY_REAL_WALK=0 GALLERY_CPU=1`, a restored build and every state uncached. CPU is the job's cgroup during the Playwright phase. Other projects shared the laptop throughout (load average 6 to 26), so single runs vary by about 10%; every comparison below alternates before and after runs, one remote job at a time.

## Where the time goes

`GALLERY_PROFILE=1` on the computed walk alone (`test:gallery computed-shift.spec.ts`, 1,835 states, 7,580 elements, 4 remounts) at `3df2afe50`, summed over states and workers (wall, not CPU):

| Phase | Seconds |
| --- | ---: |
| Open the state | 99.3 |
| Cursor and whole-pixel rules | 8.4 |
| Document reloads | 2.8 |
| Events (act) | 24.1 |
| Settle: tasks, animations, focus | 114.2 |
| Box snapshots | 50.5 |
| Diffs | 1.8 |
| Stylesheet rewriting | 0.2 |

A Chromium trace of 25 states in one worker showed the renderer main thread using 1.73 of the browser's 2.4 thread CPU-seconds; raster, compositor and display together used about 0.6. Style recalculation was the largest main-thread item (0.66 s), and 0.43 s of it was 146 recalculations of the whole document (834 elements, most of them the gallery's switcher), each right after a hover's `mousemove` or a leave's `mouseleave`. The forced check took the hover attribute off `<html>` and `<body>` on every leave and put it back on the next hover. The app's `stylex.when.ancestor(':hover')` rules compile to `:where(.x-default-marker:hover *)`, so a hover change on an element restyles its whole subtree.

After the fix below, CDP `Performance.getMetrics` around each phase gave the renderer main thread's task time, summed over workers: the forced check 176 s (style 58 s, layout 1 s), opening 45 s, the rules check 4 s. A V8 profile of one part (60 states) had the renderer idle 41% of the time; of the busy time, `document.getAnimations()` (the style flush after each touch) was 18% and box reads about 15%. That remaining style work is the same a browser does for real hover, press and focus, so it was left alone.

## Changes kept

**Leave keeps the pointer over the page** (`touches` in `packages/testing/src/forcedShift.ts`). The real-input walk leaves by moving the mouse to (2, 2), over the gallery's switcher, so `<html>`, `<body>` and the frame's other ancestors stay hovered. The forced check now does the same: leaving clears the hover attribute from everything except the root's ancestors, and hover sets it only where it is missing. Every hover rule in the gallery's rewritten sheets that matches an ancestor needs `.x-default-marker` or `[data-scroll-area]`, which no ancestor of the frame has, so no computed style changes. Events are dispatched as before. Three alternating rounds of the computed walk:

| Run | CPU-s | Wall | Settle (summed) |
| --- | ---: | ---: | ---: |
| Before | 355.2, 337.2, 343.9 | 64.0, 61.3, 62.1 s | 122.9, 115.3, 118.6 s |
| After | 285.6, 312.6, 284.6 | 52.9, 57.2, 52.6 s | 71.0, 81.6, 70.7 s |

**Page helpers compiled once per document, with reused box buffers** (`withHelpers` and `boxReader` in `packages/testing/src/inPage.ts`). The guards installed their functions as source on every `page.evaluate`; the page now compiles them once into `__junoHelpers` and later calls send only the arguments. The box reader keeps its element list until a `MutationObserver` on the root sees an element added, removed or moved, writes boxes into two typed arrays used in turn, and compares by index when the list is unchanged. Every box is still read after every step, with the same offsets, rendered test and comparison. Both guards use it. The shared-page reset accepts `__junoHelpers`, which holds only functions. On top of the leave fix, three alternating rounds:

| Run | CPU-s | Box snapshots (summed) | Diffs (summed) |
| --- | ---: | ---: | ---: |
| Before | 297.7, 281.6, 283.1 | 49.2, 47.7, 48.1 s | 1.6, 1.5, 1.5 s |
| After | 273.3, 271.7, 287.6 | 43.5, 43.2, 44.4 s | 0.3, 0.3, 0.3 s |

The phase saving is consistent in every round (about 6 s of summed state time, 2%). The job CPU medians fell from 283 to 273 CPU-s, but the ranges overlap, so the job-level effect of this change alone is within the noise.

## Tried and not kept

**`deviceScaleFactor: 1` for the computed walk.** Three alternating rounds on top of the leave fix: 323.1, 301.3, 304.8 CPU-s at scale 2 and 295.8, 351.2, 316.6 at scale 1. No measurable win: raster and display are a small part of the work. The verdict check (layout and whole-pixel rows at both scales) was not needed and was not run.

## Before and after, the whole gallery job

`bun run remote --cores 3 --wait 900 --env GALLERY_SHIFT_ALL=1 --env GALLERY_REAL_WALK=0 --env GALLERY_CPU=1 test:gallery`, two alternating rounds; before is `3df2afe50`, after is both changes:

| Run | Job | Script time | Playwright CPU | Playwright wall | Computed spec CPU | Peak container memory |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Before | `1793040870512-36813-f83e938b` | 86 s | 417.5 CPU-s | 83.3 s | 282.5 CPU-s | 4.43 GB |
| After | `1793040959856-41563-ca03701c` | 75 s | 350.2 CPU-s | 72.5 s | 217.0 CPU-s | 4.23 GB |
| Before | `1793041038802-42489-0708fe85` | 89 s | 444.3 CPU-s | 87.3 s | 345.9 CPU-s | 4.27 GB |
| After | `1793041132190-43889-e9410e6d` | 80 s | 383.1 CPU-s | 78.6 s | 242.6 CPU-s | 4.20 GB |

About 64 CPU-s (15%) and 9 to 11 s of job wall less per round. Every run checked 1,835 states and 7,580 elements with 4 remounts: 167 passed and the 6 broad real-input parts skipped on purpose, as before.

## Guard checks

With the [mutation patch](2026-10-26-gallery-shift-mutations.patch) applied, `bun run remote --cores 3 test:gallery /history-probe.spec.ts /shift.spec.ts /computed-shift.spec.ts /shared-page.spec.ts --grep-invert "in any state of any component"` passed 71 tests: the computed tier's 12 self-tests, the real guard's self-tests and targeted regressions, the shared-page reset checks and all 11 history probes with their recorded outcomes (the forced check still reports the six transplanted rules and the focused Show result probe; the task-footer probe still does not reproduce its old shrink). The temporary probe spec was removed afterward.

## The real-input walk over every state

`bun run affected` on this change re-keyed every real-input state, and all four workers of that walk aborted with SIGABRT about 600 s in. It is not the guard change: a four-worker walk on main at `dd5e712c1` showed the same worker heap growth, from about 150 MB to 175–183 MB over the first 100 states, and passed only just (571 s); this branch showed 145–152 to 169–182 MB. Playwright's worker keeps a record of every call a test makes (`_steps` and `_stepMap` in its `TestInfo`) until that test ends, and one walk part made tens of thousands of calls over about 460 states, past the 256 MB heap cap from `1809ff1f7`.

The walk is now at least 16 tests, four per part, each walking at most `ceil(states / tests)` of the selected states. Every test runs to its limit or an empty queue, so together they always walk every state. The record keys are built once per worker, and the shared page still reloads every 150 states, counted across the walk's tests. A four-worker walk over every state then passed (`1793043423627-53531-339f3d9c`, 630 s): 16 tests walked 1,835 states, 7,566 elements and 547 remounts, the same counts as the last recorded full real-input walk, and each worker's used heap stayed under 150 MB. The computed walk makes about five calls a state, not about 80, and keeps one test per part.

## The CPU reporter's NaN

`scripts/gallery-cpu-reporter.mjs` looked for the worker by `TEST_WORKER_INDEX` in `/proc/<pid>/environ`. Playwright sets that variable inside the worker once it runs, so only the browser the worker launches shows it: the reporter charged the browser and not the worker's own Node process, and found nothing for a worker's first test (no browser yet), which made its spec and the total `NaN`. It now notes every child of the runner when a test begins and finds the worker as the runner's child above that browser when the test ends. In the run above it charged 988.7 of the job's 1,015.4 CPU-s, with no `NaN`.
