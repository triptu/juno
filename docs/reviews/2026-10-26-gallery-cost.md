# Gallery cost, 2026-10-26

All measurements use the laptop, three physical cores (six threads), pinned Chromium, zero retries, `GALLERY_SHIFT_ALL=1 GALLERY_REAL_WALK=0`. The baseline uses eight workers; candidate worker counts are listed below. Every fast state and rendering test runs uncached. Builds restore the same artifact. Runs are sequential from this worktree; other projects and the other two optimization tasks share the host through its allocator. These are single observations, not medians or a claim about run-to-run variation.

Baseline `64e5fcdf6`, job `1793025178507-53732-c12477ea`: 107 s script time; 572.0 CPU-s over 104.6 s in Playwright; 169 passed, eight broad real-input parts intentionally skipped. All 1,835 states and 7,580 sampled elements ran. Four states needed a remount after removing another target. The existing inaccessible scrollbar pseudo-element rule remains reported as one unforced rule. Memory peaked at 5.96 GiB including file cache; six allocated threads were 91% busy on average.

Separate baseline profile `16ea7a53c`, job `1793025297451-55048-c6bbd533`: 106 s script time, 571.0 CPU-s, same state and element counts. `GALLERY_PROFILE=1` records one JSON line per state in the Playwright JSON report's stdout. `GALLERY_CPU=1` records per-spec process-tree CPU and wall spans. Initial worker startup can precede PID discovery, leaving NaN for the first spec in a worker; the cgroup total remains available. The per-state timing includes scheduling under concurrent workers, so these sums are not CPU time and cannot be added to job wall time.

| Baseline state phase | Summed seconds |
| --- | ---: |
| Open state, wait for fonts, images, chunks and entrance motion | 131.002 |
| Cursor and whole-pixel checks, including browser call | 11.536 |
| Periodic document reload | 3.158 |
| Forced check browser call | 422.521 |
| Inside forced check: events | 48.354 |
| Inside forced check: tasks, animations and focus | 204.861 |
| Inside forced check: box snapshots | 129.895 |
| Inside forced check: diffs | 3.063 |
| Inside forced check: stylesheet rewriting | 0.401 |

The forced check's browser time totals 410.506 s. Its remaining 12.015 s includes driver serialization, round trips and scheduling. It already checks all sampled elements and six steps in one `page.evaluate`; splitting or batching targets cannot eliminate that work. Open-state readiness uses four calls, with a further call for drawn rules. Periodic reloads account for less than one wall second across workers.

The cost is distributed: the slowest state is 0.4% of summed state time, the slowest 10 are 3.0%, 100 are 19.7%, and 184 (10%) are 31.1%. The slowest half account for 82.4%. MediaViewer's CSV state is the largest at 2.46 s, followed by off-screen sidebar art at 1.99 s. Optimizing a handful of large fixtures cannot save the requested 20 seconds.

The [per-spec before/after table](2026-10-26-gallery-spec-cost.tsv) preserves every reported spec, including unavailable startup CPU samples. Other baseline specs: contrast costs 4.6 CPU-s (6.4 s span), geometry 0.4 CPU-s (1.3 s span), narrow geometry 2.3 CPU-s (3.2 s span). Behaviour's 20 tests sum to 27.7 s with a 9.4 s span; its CPU is unavailable due to worker startup. Their geometry/colour reads are already batched; navigation stays within the loaded document. Real hover, wheel chaining, late data and pending-image waits retain their purpose. The shared-page checked reset stays unchanged.

The change reuses a MessageChannel for each forced check and closes it in `finally`, retaining two posted tasks after every event. Previously every posted task constructed and closed another channel: at least 90,960 channels for 7,580 elements. Focus attributes now change only when focus or keyboard modality changes; unchanged ancestors are no longer cleared and restored. Synchronizing before the animation read avoids flushing the old focus styles then invalidating them again before the snapshot. Every event, sampled target and whole-frame box comparison remains. Narrowing snapshots to the target subtree would miss siblings pushed by a parent and is not used. Stylesheet rewriting is already cached per loaded sheet, so it is not a worthwhile target. The full-run job plan stays unchanged; the worker comparison follows below.

The first candidate (`1793025742517-12852-888470e3`) passed every check at 102 s / 542.1 CPU-s. It was a five-second improvement, short of the goal. Its state sums were 129.372 s opening, 223.511 s settling and 76.819 s reading boxes. A subsequent snapshot experiment (`1793026203363-68016-1cf3fc20`) tried avoiding client-rect reads for elements with nonzero dimensions. It produced false shifts in off-screen NotificationDetails rows using `content-visibility`, and was reverted. No changed box-reading or comparison code is retained.

The next change keeps the forced focus-attribute sets for one check rather than querying the entire document twice per step. It still synchronizes the full ancestor chain as focus moves. An in-place state open waits for the frame's visible box beside the hash navigation in the browser, removing a driver call and the assertion's polling backoff if React has not committed on its first attempt. Its deadline and visible-box rule are retained; chunk, font, image and motion readiness follow as before.


## Worker comparison and retained coverage

With the final guard and navigation changes, single full runs on the same three physical cores gave:

| Workers | Script seconds | Playwright CPU-s | Job |
| ---: | ---: | ---: | --- |
| 8 | 99 | 524.3 | 1793026403246-86549-a0be64a3 |
| 4 | 95 | 350.5 | 1793026538109-87954-3c741798 |
| 6 | 89 | 429.7 | 1793026747240-9740-1ca5731c |

Six workers are the chosen full fast-only default, one per allocated thread. Four leave more CPU idle (62% busy), while eight add contention (89% busy); six were 83% busy and finished sooner. These are individual runs on a shared laptop, not a statistical ranking. Peak container memory in the six-worker run was 4.73 GiB including file cache.

All three checked 1,835 states, 7,580 elements and the same assertions, with no retries or unexpected failures. Test counts change with the number of queue parts: six workers give 167 passed and six intentionally skipped real-input broad-walk parts. The original 23 guard and historical mutation probes passed in job `1793025504580-75644-43f73028`; the final proof is recorded below.

Full per-state profiles, in milliseconds: [baseline](2026-10-26-gallery-states-before.tsv) and [six-worker candidate](2026-10-26-gallery-states-after.tsv). The six-worker profile totals 97.055 s opening, 7.844 s drawn rules, 2.671 s reloads, and 224.338 s in forced browser calls (215.290 s inside the browser). Inside those calls: 24.574 s events, 116.854 s settling, 50.812 s snapshots, 1.778 s diffs and 0.229 s stylesheet rewriting. Sums overlap across workers.

Commands (each run separately, never in a loop):

```sh
bun run remote --cores 3 --wait 600 --env GALLERY_SHIFT_ALL=1 --env GALLERY_REAL_WALK=0 --env GALLERY_CPU=1 test:gallery
# Add --env GALLERY_PROFILE=1 for state profiles.
# Add --env GALLERY_WORKERS=4, 6 or 8 to override all worker modes for a comparison.
```


## Before and after

The final **single after run**, with the new default worker selection and `GALLERY_PROFILE` off, is `1793027242939-91517-9ed3c88e` at `7afe3b0e6`: **88 s script time**, 436.3 CPU-s over 86.2 s in Playwright, 167 passed and six intentionally skipped broad real-input parts. It checked all 1,835 states and 7,580 sampled elements uncached. Peak container memory was 4.68 GiB. The **single before run** above was 107 s and 572.0 CPU-s: a 19 s (18%) wall reduction and 24% less CPU. Both used a restored build, three physical cores and per-spec CPU reporting. The before/after worker counts are eight and six. The separate state-profile runs are not used for this primary timing claim.

Conformance and the overall three-job plan were not changed. This comparison times the gallery script; it does not claim a new end-to-end full-run time. The limiting work remains browser event settling and full-frame geometry under contention, spread across hundreds of states.

The required pipeline smoke at `7afe3b0e6` passed: `.juno-status/verify-main/20261026T150554386Z/`. After merging current main at `6315bf1bd`, `bun run affected` passed typecheck, all 11 lint checks, four health checks, 47 repository-tool checks, 18 runner checks, the desktop integration spec and the gallery. Gallery job `1793027424991-97972-fa6c2b1b` passed 129 tests with 51 unchanged rendering tests skipped. It re-walked all 1,835 real-input states uncached (7,566 elements, 547 remounts); the 1,835 computed states reused the successful uncached after run.

Applying the existing history mutation patch during that affected run passed all 11 probes: hover margin, TopicRow time in flow, review explainer/outcome/key-hint geometry, ChangeCard disclosure, source wrapping, status height, Show result and both task/send outcome probes. The task-footer probe still does not reproduce the historical shrink, as the audit records; that remains a limitation, not a claimed detection. The data-change probes still require their targeted actions. The forced guard's 12 self-tests and the real guard's retained self-tests passed too. The temporary mutation spec was removed afterward; the replay patch remains unchanged.
