# Workspace emoji verification

Checked on 2026-10-20 on an Apple M2 Mac. Workspace follows the standard categories, with eight distinct fixture images and one alias. Images load only near the viewport; the focused row stays mounted.

The round-two regression checks failed before their fixes: prefix ordering, `:smi`, a recent `party_parrot`, kind-aware chosen state, the failed-image placeholder, a picker blocked on delayed workspace data, and Settings recording recent use. A further real-catalog check caught a matching alias being sorted by its unrelated canonical name; ties now use the matching name. The delayed-data flow checks a visible recent cell before its image arrives, then retains that cell’s focus, count and position when its alias resolves.

Standard emoji now appear immediately even without workspace data. Known recent names have visible CSS placeholders, with their names in tooltips and accessible labels; incoming images fill those cells. Workspace arrives last, and subsequent table changes wait until the next open. Search and Enter share the composer’s exact/recent/common/prefix/substring ranking. Settings resolves chosen aliases within their standard or workspace kind and does not record a preference pick as recent use.

The [performance record](../../performance.md#workspace-emoji-picker-2026-10-20) gives the cold-open, idle-preload and decoder comparisons. The final ten cold opens passed at 41.9 ms median and 47.4 ms p95 with 20,000 distinct image URLs, a cold subscription and loaded visible images. The generated decoder was removed because its median saving was below 5 ms. The final start bundle is 1,068.1 KB JS and 154.1 KB CSS.

The Workspace screenshots are saved in `/Volumes/AgentWork/juno-workspace-light.png` and `/Volumes/AgentWork/juno-workspace-dark.png`.

The earlier Juno reaction feel check passed four checks over 46 frames; the badge did not move the bubble. Fake-Slack reaction tests cover the raw custom image URL, name and alias picks sent to `reactions.add`, and the loaded chip image. The [Slack name research](../../research/slack-emoji-names.md) records the evidence and its limits; no live workspace write was used to test names.

`pnpm affected` ran once. Unit tests passed 1,557 checks with nine skipped, and gallery passed all 288 checks. Desktop passed 77 checks with three skipped and failed two old assertions: an ambiguous alias prefix expected the alias rather than the canonical insert, and the reaction delivery check still expected failed-image text. Lint found an unused re-export added for preload timing.

Those issues are fixed. Final Bun typecheck and all 11 lint checks pass. The two corrected fake-Slack flows passed on the Mac (3.9 s composer alias, 3.2 s reaction delivery), including a loaded reaction-chip image. An additional broad remote follow-up was stopped after an unrelated standard-case synced-start fixture exceeded 30 s; that case passed in the affected run. `pnpm affected` was not repeated. Both screenshots were refreshed from its passing gallery run and inspected in light and dark.
