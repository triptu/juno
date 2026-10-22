# Release 0.1.13 feel review

Run on 22 October 2026 at 06:13 IST on this Mac, app commit `11ce9c710`.
`pnpm test:feel topic.feel.ts long.feel.ts` passed all three tests in 1.1 minutes.
All ten recorded scenarios passed, with no failures or skips. Scenario load averages
were 2.7–3.7. The run held the exclusive heavy lock.

Every filmstrip was inspected, including the passing ones. No additional issue was visible.

| What a person sees | Scenario and frames | Evidence | Cause |
| --- | --- | --- | --- |
| The unread divider holds its position | `open-at-divider` #10–#49; `open-long-at-divider` #7–#103 | Passing geometry checks and filmstrips | — |
| Late images appear in their reserved space | `open-long-late-images` #10–#182 | Passing bottom, geometry and flicker checks; filmstrip | — |
| Reactions and replies preserve the reading position | All five reaction and live-reply filmstrips, first to last frames | Passing geometry checks and filmstrips | — |
| Scrolling moves in the requested direction without an empty frame | `scroll-long-thread` #1–#332 | Passing direction, layout and pixel checks; filmstrip; no frame over 50 ms | — |
| A read topic opens at the bottom in one step | `open-at-bottom` #7–#49 | Passing switch, bottom and pixel checks; filmstrip | — |

The separate `tab-scroll.spec.ts` run passed all four tests with no retry, including
frame-by-frame landing and tab restoration checks. The targeted performance run
passed its cached opening, 300-message scrolling and cold code-block jump gates.
These checks establish the existing budgets; they do not measure a speedup.

Missing for the new gallery surfaces: record opening Objects and the BCE timeline,
then choosing an artwork; check that groups, selection and preview appear together
without layout shifts or blank frames.
