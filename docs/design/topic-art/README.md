# Topic art

Each thread topic gets a small icon about what it is actually about: a database with a migration arrow for "Postgres 16 migration plan", coins with a rising line for "Staging bill doubled since August". An LLM decides it when the topic is first titled. This folder is the study that compared four ways to get that icon, on three models, over 24 topics. Exploration only; nothing here is wired into the app.

Files:

- `topics.mjs`: the 24 study topics. Twenty from the fake-slack fixtures and four tricky ones (emoji-only, vague, Japanese, "hmm"). Each carries what the app has at titling time: title, channel, first and latest message.
- `palette.mjs`: eight hue anchors (the channel-mark anchors, so the two systems agree) and four roles per hue per theme: `tile`, `soft`, `ink`, `accent`.
- `vocab.mjs`: the constrained SVG vocabulary. Parser, validator and renderer. Approaches B, C and D all render through it.
- `motifs.mjs`: the hand-drawn motif kit, 80 motifs written in the vocabulary. `kit-preview.mjs` renders it to `kit.png`.
- `free-svg.mjs`: the strip applied to approach A's output so it can be shown on a page.
- `prompts.mjs`: the four briefs. `openrouter.mjs`: the client. `run.mjs`: runs one approach on one model and writes `generated/<approach>/<model>/<topic>.json` and `.svg`. `run-compose.mjs`: approach C's deterministic composition.
- `build-sheet.mjs`: collects `generated/` into `results.js` and `stats.md`. `sheet.html` draws the contact sheet; `render.mjs` screenshots each section to `<approach>-<model>.png` and `sidebar-<approach>-<model>.png`.
- `iterations/v1/` and `v2/`: the first two passes, kept for the record (renders and stats). `generated/` holds the final pass, with every model reply, the checked spec and the rendered SVG per topic.

Run from this folder: `node run.mjs --approach C --model anthropic/claude-haiku-5.5`, then `node build-sheet.mjs --top C/anthropic_claude-haiku-5.5,B/anthropic_claude-sonnet-5.5` and `node render.mjs`. The key is read from the main checkout's `.env` at call time and never written anywhere.

## The approaches

Every approach gets the same topic block (title, channel, first message, latest message) and the same one-paragraph style brief: one clear object, literal beats clever, no text, no faces, no logos.

| | Approach | Idea | Strengths | Weaknesses |
| --- | --- | --- | --- | --- |
| A | Free SVG | The model draws any SVG from a prose brief with suggested hex colours. | Nothing to build. The strong model draws competent icons. | The model owns the colours, so there is no theme: the same hex lands on paper and on ink. Stroke weight and visual size drift from icon to icon. The cheap model collapses into one generic glyph for a third of the topics. Gemini writes so much SVG it overruns the token budget and fails. Unparsed SVG from a model is a security surface, and stripping tags is not a parse. |
| B | Constrained vocabulary | The model may only use seven primitive elements on a 40 grid, colours as role tokens (`ink`, `soft`, `accent`, `tile`), a hue name on the root, at most 12 elements. The output is parsed into a typed shape, checked, and rendered from that shape. One retry on failure. | Same line language and palette as the rest of Juno by construction; light and dark come from the renderer. The most varied of the safe approaches: a flask for a flaky test, scissors for roadmap cuts. Zero validation failures on the Claude models. | Quality rides on the model: the cheap model's drawings are rougher (an alarm clock with a lopsided bell, a chart with a kink). A few icons per batch look like a different weight. Costs an SVG-sized completion per topic. |
| C | Motif kit | 80 motifs hand-drawn in the vocabulary (75 in the first two passes). The model returns JSON: a main motif, an optional small secondary badge, a hue, and whether it is confident. Composition and rendering are deterministic. | Every icon is designed. The list stays calm because every tile shares one hand. The decision is tiny (about 40 output tokens), so it fits the decision tier and runs on the cheapest model with the same quality as the strongest. A "not confident" answer keeps the channel mark, which is the quiet default the spec asks for. | Bounded by the kit: a topic outside it gets the nearest motif. The first pass put a secondary badge on 22 of 24 tiles; the rule had to say "null for most topics". The kit is a design asset to maintain. |
| D | Vocabulary plus kit | B's vocabulary with one more element, `<motif name=… x y scale/>`, and six kit motifs written out as examples. The model may place kit motifs, draw, or mix. | The best of both in theory: the kit where it fits, drawing where it does not. In practice the model places kit motifs almost every time, so the output is C's. | C's output at two to three times C's price (the prompt carries the kit and the examples) and with an SVG-sized completion. Not worth its place. |

## Measured

Twenty-four topics, three models, one pass each, through OpenRouter on 2026-10-13. Latency is wall clock for the call including one retry where one happened. Cost is what OpenRouter reported for the call, without prompt caching. Failure means no usable icon after the retry. Claude Haiku ran with reasoning off; Sonnet and Gemini refuse that setting and ran at the lowest reasoning effort, which is part of their latency and cost.

| Approach | Model | OK | Failure rate | Retried | Median latency | p90 latency | Cost per icon | Cost per 300 topics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A · Free SVG | Claude Haiku 5.5 | 24/24 | 0% | 0 | 1.3 s | 5.9 s | $0.0002 | $0.05 |
| A · Free SVG | Claude Sonnet 5.5 | 24/24 | 0% | 0 | 1.2 s | 3.2 s | $0.0036 | $1.07 |
| A · Free SVG | Gemini 3.8 Flash | 24/24 | 0% | 0 | 2.8 s | 3.2 s | $0.0051 | $1.54 |
| B · Constrained vocabulary | Claude Haiku 5.5 | 24/24 | 0% | 0 | 1.2 s | 2.1 s | $0.0002 | $0.07 |
| B · Constrained vocabulary | Claude Sonnet 5.5 | 24/24 | 0% | 0 | 1.6 s | 4.4 s | $0.0045 | $1.36 |
| B · Constrained vocabulary | Gemini 3.8 Flash | 24/24 | 0% | 1 | 2.9 s | 4.4 s | $0.0055 | $1.64 |
| C · Motif kit | Claude Haiku 5.5 | 24/24 | 0% | 0 | 1.1 s | 4.9 s | $0.0002 | $0.07 |
| C · Motif kit | Claude Sonnet 5.5 | 24/24 | 0% | 0 | 1.2 s | 1.9 s | $0.0045 | $1.36 |
| C · Motif kit | Gemini 3.8 Flash | 24/24 | 0% | 0 | 1.8 s | 2.6 s | $0.0013 | $0.39 |
| D · Vocabulary + kit | Claude Haiku 5.5 | 24/24 | 0% | 0 | 1.7 s | 11.5 s | $0.0004 | $0.12 |
| D · Vocabulary + kit | Claude Sonnet 5.5 | 24/24 | 0% | 0 | 1.3 s | 2.8 s | $0.0081 | $2.42 |
| D · Vocabulary + kit | Gemini 3.8 Flash | 24/24 | 0% | 0 | 2.6 s | 3.4 s | $0.0034 | $1.02 |

Notes on the numbers:

- The three models agree on the kit. The final C renders are near-identical across Haiku, Sonnet and Gemini (database and arrow, bell and moon, lock and key, scissors or board-and-scissors for the roadmap cuts). The decision is easy enough that the cheapest model is as good as the strongest, which is the point of C.
- Gemini's early failures on A and B were a harness fault, not a model one: its thinking tokens count against the completion budget, so a 900-token cap cut the SVG off before the closing tag (15 retries on B in the second pass). With a 2,500-token cap for B and 4,000 for A it completes every topic, at four to five times Haiku's price per icon. The numbers above are after the fix; `iterations/v1/stats.md` and `v2/stats.md` keep the earlier passes.
- The one-off p90 outliers (Haiku D 11.5 s, Haiku C 4.9 s) are single slow calls in a batch of 24, not a pattern; medians are 1.1 to 1.7 s on Claude.
- Cost per 300 topics is the measured per-icon mean times 300. The real workspace has 303 followed threads today.

Quality, by eye, from the renders (`<approach>-<model>.png`):

| Approach | Claude Sonnet 5.5 | Claude Haiku 5.5 | Gemini 3.8 Flash |
| --- | --- | --- | --- |
| A | Competent, varied, but no theme and no shared weight. Reads as a different icon set per row. | A third of the topics collapse into one generic two-line glyph. Out. | Completes with a big budget; heavier lines, more coral, same theme problem. |
| B | The best drawn set in the study after the three examples were added: flask for the flaky test, scissors for the cuts, a star for the icon refresh. Two of 24 slightly off weight. | Serviceable; three or four rough drawings per batch (a lopsided alarm, a kinked chart). | Inconsistent: an empty ellipse for the flaky test, a briefcase for the candidate (good), 4.5 s median. |
| C | Calm and sensible. 13 of 24 with a secondary badge after the rule change; 3 fallbacks on the tricky topics. | Same decisions as Sonnet on 20 of 24 topics. 11 secondaries, 2 fallbacks. | Same decisions again; uses the badge more (17). |
| D | C's icons at twice the price. | C's icons, one 11 s call. | C's icons, 2.6 s median. |

The first pass (`iterations/v1/`) put a secondary badge on 22 of 24 tiles with Sonnet. Telling the model "null for most topics" and naming the three cases where a badge changes the reading halved that. The second pass (`iterations/v2/`) showed B drawing five things the kit lacked, so the kit grew by flask, scissors, alarm, briefcase and lightbulb before the final pass, and both Claude models picked scissors for the roadmap cuts on their own.

## Ranking

1. **C, the motif kit, on Claude Haiku 5.5.** Every icon is designed, the list stays calm, the model never writes markup, and it costs $0.0002 per icon at a 1.1 s median. The quality is the same on the strongest model, so there is no reason to pay for it.
2. **B, the constrained vocabulary, on Claude Sonnet 5.5.** The most varied safe set, inside the vocabulary and the palette by construction, at $0.0045 per icon. The right choice if the owner wants drawing rather than choosing, and the right fallback inside C for a topic the kit cannot say (one call on the generation tier when the kit answer is `confident: false` for a topic that is not vague, which did not come up in this set).
3. **C on Gemini 3.8 Flash.** Same decisions, 1.8 s, six times Haiku's price. A second-provider fallback, nothing more.
4. **B on Claude Haiku 5.5.** Cheap and usually fine, with a few rough drawings per batch that the user would notice.
5. **D on any model.** Produces C's icons and costs two to three times as much. Drop it.
6. **A on any model.** No theme, no shared weight, unparsed markup. Drop it.

Recommendation: ship C on the decision tier with the kit, and keep B's vocabulary and validator in the folder as the gate to use if drawing is ever added. The kit is the design asset: 80 motifs today, grown from the first 75 by looking at what B drew. The brief's three examples come out as the database with a migration arrow, the id card with a check (the model reads "references came back, all positive" as done) and the cloud with a rising line for the staging bill; Rina's hiring thread gets a person with an hourglass for the Friday deadline, which is better than two chairs.

## How it would work in the app

Topic art is a client-only decoration, like titles and channel icons (SPEC section 3). It never reaches Slack.

**What is stored.** One row per topic in the durable user database: `topic_art(topic_id, task_version, input_hash, main, secondary, hue, confident, source, created_at)`. `source` is `ai`, `redraw` or `user`. The SVG is never stored; it is rendered from these five fields. A row is about 60 bytes, so a 900-row workspace is nothing.

**When it runs.** A new structured task `topicArt` in `@juno/ai`, on the decision tier, beside `titleTopic`. Its input is the title the user will see (the renamed, AI or fallback title, in that order), the channel name, and the first and latest message, the same block `titleTopic` reads. It runs right after the title resolves for a thread that enters the sidebar, in the background, with the channel mark showing in the meantime. The output schema is `{ main, secondary, hue, confident }` with `main` and `secondary` as enums of the kit names and `hue` an enum of the eight hues; the task's `accept` rule rejects `secondary === main`. The measured median on Haiku is 1.2 s and the p90 2.3 s, so this task's timeout is 3 s, above the tier default of 1.5 s; it is background work and nothing waits on it. A `NoDecision` keeps the channel mark and is retried on the next drift, not on a timer.

**Drift and Redraw.** The cache key is `cacheKeyOf(topicArt, input)`, so the art regenerates exactly when the title task does: on the drift rule SPEC section 15 gives titles, not on every message. A row with `source: user` (a motif the user picked, once a picker exists) is never regenerated. "Redraw" in the row's context menu reruns the task with the previous `main` passed as `avoid`, stores the answer with `source: redraw`, and shows the usual undo toast. Rename changes the title, so it changes the input hash, so it redraws; "Use AI title" does the same in reverse.

**Fallback.** The tile shows the channel mark whenever there is no art to show: while generating, when the answer is `confident: false`, after a `NoDecision`, when the topic is a Main row, and when AI assist is off. Nothing in the tile signals which case it is. The sparkle stays on the title (SPEC section 3); the art carries no AI mark because it is decoration, not a claim.

**DM rule.** A DM's Main row keeps the person's photo: that row is the person. A thread inside a DM is about something, so it gets art like any other thread, with the person's photo in the meta line's avatar stack to keep the who. This is the one change to the brief's placement rule and it falls out of the Main-versus-thread distinction the spec already makes.

**Rendering.** A pure function in a small package (`@juno/topic-art`, no React, no Effect, no tokens import, like the channel-marks plan): `(spec, size) → SVG string`, built from the kit the way `vocab.mjs` renders it here. `TopicArt` in `@juno/ui` renders the string inline inside the existing tile, memoised on `${main}:${secondary}:${hue}:${size}`. Sizes under 20 drop the secondary badge and detail elements and thicken the stroke by 20%, so the tab icon at 16 and the header icon at 20 come from the same spec. No gradients, no filters, three to nine elements per icon; the per-row cost is a string lookup, inside the list budgets in `docs/performance.md`.

**Theme.** The renderer writes role tokens as CSS variables, not hex: `var(--art-teal-ink)` and so on, 32 variables (8 hues × tile, soft, ink, accent) added to `@juno/tokens` with the light and dark values from `palette.mjs`. One string serves both themes and a theme switch repaints through CSS like everything else, with no re-render of the list. The channel marks can move to the same variables later so the two systems share one palette. Accent colour changes do not touch the art: the art's `accent` role is the warm highlight from `palette.mjs`, not `--hl`.

**Security.** With the kit, the model never produces markup. Its answer is four short strings checked against enums by the TypeBox schema before anything else sees them, and the SVG is assembled from our own motif table. There is no sanitiser because there is nothing to sanitise. If the constrained vocabulary (B) is ever adopted for drawing, `vocab.mjs` is the shape of the gate: whitelist seven tags and their attributes, numbers within range, colours only as role tokens, no `use`, `href`, `style`, `script`, `text`, `defs` or `foreignObject`, then rebuild the markup from the parsed shape so no model byte passes through. Approach A's strip is not that and should not ship.

**The AI-off switch.** The global AI assist switch (SPEC section 15) turns the task off and the tile falls back to the channel mark. Stored rows stay, so turning it back on is instant and costs nothing. "Clear AI data" in preferences, when it exists, deletes the rows with the titles.

**Cost controls.**

- Decision tier only. Measured on Haiku: $0.0002 per icon, $0.07 for 300 topics, without prompt caching. The kit prompt is about 1,700 tokens and identical on every call, so Anthropic prompt caching through OpenRouter should cut the input cost by most of that; measure once wired.
- Only topics that enter the sidebar get art (303 threads on the real workspace today), on first sight, once. Main rows never do.
- Regeneration follows title drift only. A busy thread does not redraw on every message.
- First sync runs the backlog at concurrency 4 in the background, lowest priority, and stops when AI is switched off.
- A per-workspace daily cap on art calls (500 is plenty) with the channel mark as the fallback, so a runaway loop costs cents, not dollars.
- One retry on an invalid answer, inside the timeout, as every decision task already does. No second model.

**Spec edits when adopted.** SPEC section 5 "The tile is the channel's icon or a person's avatar" becomes "The tile is the topic's art for threads, the channel's mark for Main rows, and the person's photo for a DM's Main." SPEC section 15 gains a row: Topic art, Decision, with the title and on drift, always (channel mark when not confident). The row context menu gains "Redraw".

## Spend

Total OpenRouter spend for the study, summed from the cost OpenRouter reported on every call across the three passes: $1.57, against the $8 cap. The final pass alone was $0.89.
