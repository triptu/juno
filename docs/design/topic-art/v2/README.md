# Topic art, round 2

Round 1 (`../README.md`) chose constrained-vocabulary drawing on Gemini 3.8 Flash (approach B). The owner then asked for:

- a plain explanation of the vocabulary;
- a comparison of three levels of creative freedom;
- a look at containers, because the round 1 tile was too rounded;
- much more muted colour, tuned separately for light and dark;
- art for channel Main rows too;
- the Tide mark as the placeholder for every topic.

This folder holds that study. Everything here is a design study, not app code. The owner's decision from it (decision log, 10-13 23:38 and 23:40): art-directed drawing on Gemini 3.8 Flash, no container, and a placeholder that is a free-form shape picked per topic, not a rounded box. The renders reflect that decision; the subtle container stays in the sheet for the record.

## What to look at

| File | What it shows |
| --- | --- |
| `vocabulary.md` | The vocabulary in plain English: canvas, elements, stroke, colour roles, the three levels, the validator, failure, sanitising. |
| `palette.png` | The muted palette per hue, light and dark, with contrast against the sidebar, and the Tide tones under each hue. |
| `strict-*.png`, `relaxed-*.png`, `art-*.png` | Each freedom level in each container (`none`, `subtle`, `tile`). Every grid has 35 topics (24 threads and 11 channel Mains) at 40px and 16px, in light and dark, plus four Tide placeholders. |
| `placeholders.png` | The Tide placeholder for every topic in each container and theme, and the cross-fade from placeholder to art. |
| `sidebar-art-none.png` | Mock sidebar, the decision: art-directed with no container, light and dark, with two pebble placeholders. |
| `sidebar-art-subtle.png` | Mock sidebar, the alternative that was not chosen: art-directed in the subtle container. |
| `sheet.html` | The source of every PNG. Open it from this folder; it reads `results.js`. |
| `iterations/` | Pass 1 renders and generated files, and the pass 2 renders from before the last palette and inset changes, when the no-container placeholder was still a 32px rounded square. |

The sidebar mocks use the C1 + D1 look: Figtree, Coral accent, rounder shapes. Each has about 10 rows:

- thread topics;
- channel Main rows with the Main tag;
- DMs with photo placeholders;
- two Tide placeholders: a thread whose art is still generating, and a Main where the model was not confident.

The row footer follows the 10-13 spec change: channel icon and name, the avatar stack and tags, no message count, no "Messages outside threads" label, and on a Main row a thread icon with the number of new threads when it is not zero. Next to each sidebar are the tabs at 16px and the topic header at 20px.

## The vocabulary in brief

`vocabulary.md` has the full version. In short:

- **Recipe, not picture.** The model sends a short recipe in a tiny SVG dialect on a 40 by 40 grid.
- **Allowed elements.** Seven shapes: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline` and `polygon`. The looser levels also allow `g`.
- **Colours are roles, not values.** The roles are `ink`, `soft`, `accent`, `accent2` and `none`. The model names one hue for the icon from a list of eight.
- **One shared line.** Every line is ink at 2.75 units with round caps and joins, set once by the renderer.
- **Whitelist check.** We parse the reply and check each tag, attribute and number against a whitelist. Anything unknown fails the whole drawing.
- **We draw the icon ourselves.** The SVG is rebuilt from the checked spec, so no byte of model output reaches the page.
- **On failure.** The reason goes back to the model once. If the retry also fails, the topic keeps its Tide placeholder.

The three freedom levels share that parser and differ in what the checker enforces:

| | a · strict | b · relaxed | c · art-directed |
| --- | --- | --- | --- |
| Elements | up to 12 | up to 20 | up to 40 |
| Groups | none | one level | two levels |
| Colours | ink, soft, one accent | adds accent2; up to two accents | adds accent2; any number of accents |
| Stroke width | 2 to 4 | 1.5 to 4, plus dashes | 1 to 5, plus dashes |
| Prompt | rules and three worked examples | rules and two worked examples | a prose style guide; no examples |
| Checker enforces | every rule | every rule | only safety, palette tokens and size |

## Measured

Gemini 3.8 Flash (`google/gemini-3.8-flash`) via OpenRouter, at the lowest reasoning effort, on 2026-10-13.

- **Topics.** 35: 24 thread topics plus 11 channel Mains. Mains get their name, purpose and recent top-level messages.
- **Latency.** Wall clock per icon, including a retry when one happened.
- **Cost.** What OpenRouter reported per call, without prompt caching.
- **Failure.** No valid drawing after one retry.

This table is the final pass (pass 2, final prompts):

| Level | OK | Failure rate | Retried | Median latency | p90 latency | Median elements | Not confident | Cost per icon | Cost per 300 topics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a · strict | 35/35 | 0% | 4 | 2.3 s | 4.7 s | 5 | 2 | $0.0051 | $1.53 |
| b · relaxed | 34/35 | 3% | 5 | 2.5 s | 4.2 s | 6 | 2 | $0.0057 | $1.72 |
| c · art-directed | 35/35 | 0% | 2 | 2.3 s | 4.8 s | 6 | 3 | $0.0058 | $1.73 |

Across both passes (70 calls per level):

| Level | Failures | Retries |
| --- | --- | --- |
| Strict | 0 of 70 | 5 of 70 |
| Relaxed | 1 of 70 | 7 of 70 |
| Art-directed | 0 of 70 | 3 of 70 |

The only failure was relaxed "2027 headcount plan", which used three accents twice in a row. The pass 1 table is in `iterations/pass1/stats.md`.

What the numbers say:

- **Cost and latency do not separate the levels.** Gemini's own reasoning tokens dominate both (median 600 to 1,000 output tokens for a 400 to 700 byte drawing).
- **Freedom did not make drawings bigger.** Art-directed drawings are no larger than relaxed ones (median 6 elements, at most 10, against a limit of 40).
- **The art-directed checker had the fewest retries.** It has the fewest composition rules for the model to trip on.
- **"Not confident" works.** Every level flagged `hmm` and `Re: that thing from yesterday`. Art-directed also flagged the emoji-only title. Those topics keep the placeholder.
- **Stored size.** A stored canonical spec is 370 to 980 bytes.

## What the renders show

**Freedom levels.**

- *Strict* is the most uniform in weight, but the ideas are weakest. #eng is an abstract shape, #leadership a compass, a rocket appears twice, and several drawings are generic category symbols.
- *Relaxed* adds nothing visible over strict and is the only level that failed validation.
- *Art-directed* draws the most specific objects: a terminal for #eng, a server for #platform, a coin stack for the bill, a clipboard for the 1:1 notes, a bowl and chopsticks for lunch. Its line weight is as even as strict's, because the renderer owns the default stroke.
- Its weakest drawing is the "Q4 roadmap cuts" scissors. A stray dash mark makes it read as a broken link. One odd drawing in 35 is acceptable when Redraw exists.

**Pass 1 to pass 2.** Main rows changed most between the passes: pass 1 drew #eng as an abstract tag and #leadership as a compass; pass 2 drew a terminal and a clipboard. The final brief (`prompts.mjs`) asks for the concrete thing in the messages over a symbol for the category, and bans stock symbols (gear, lightbulb, ship's wheel).

**Containers.**

- *No container* is the lightest. The art reads as a glyph beside round photos, which tells DMs and topics apart at a glance. It needs every drawing to hold its own shape, which the brief asks for.
- *Subtle* is a near-neutral rounded square (radius 10 at 40px, lightness 0.95 in light and 0.235 in dark, with a hairline edge). It gives every row the same footprint. It matches the neutral letter tiles in the redesigned dark theme (`docs/design/dark-theme/after.png`). The placeholder swaps into exactly the same box.
- *Round 1 tile* is the most colourful and the most "app icon". It is what the owner called too rounded, and in a list of twenty it is the loudest.

**Iterating on the renders.** Three changes came from looking at the pass 2 renders:

- *Inset inside a container.* The art was composed for no container, so inside a box it touched the edges. The renderer now scales it to 80% inside a container and keeps the 2.75 line weight.
- *No container below 20px.* A box around a 16px tab glyph is noise.
- *Tide in dark.* At low lightness, amber, olive and coral turned to mud at any real chroma. The dark Tide tones now stay near neutral (chroma 0.012 to 0.026) and step in lightness instead.
- *Tide with no container.* A full 40px block was the heaviest thing in the list, heavier than any line drawing, and a 32px rounded square was still a box among drawings. The owner asked for a free-form shape, so with no container the bands are now clipped to a pebble: a smooth closed curve through six or seven points around a circle, radius 13.5 to 16.5 with seeded jitter, so each topic gets its own outline at about 30px across. The light tones went one step deeper (base L 0.905) so the pebble still reads on paper. Inside a container the frame is the container's box, as before.

**Colour.** Superseded by round 3 (`../v3/`): the art is painted in the topic's pebble hue, with chroma a little above this round's. What follows is round 2's palette.

- Lines are a warm near-neutral with only a trace of the hue. In light, ink is 7.6:1 against the sidebar; in dark it is 9.1:1.
- The hue lives in one low-chroma soft fill and one small accent. In light the accent is 3.6 to 3.9:1; in dark it is 7.2 to 7.7:1.
- In a list of ten to twenty rows the art reads as one family of grey-brown drawings with small points of colour.
- In dark the art sits a step below the text, not above it.

## Recommendation

The owner has decided: art-directed, no container (decision log, 10-13 23:38). The ranking below is kept so the reasoning stays with the renders.

1. **Art-directed, no container.** The decision.
   - It has the best drawings at the same cost, latency and failure rate as strict.
   - It is the lightest look and separates topics (glyphs) from DMs (round photos) at a glance.
   - The placeholder is a pebble of the same weight, so the swap moves nothing.
   - The cost is a slightly uneven left edge, because drawings vary in width; the brief's 5..35 margin keeps it small.
2. **Art-directed, subtle container.** The alternative that was not chosen. The box gives a steady rhythm down the list and matches the dark theme's letter tiles, at the price of a box on every row.
3. **Strict, subtle container.** The fallback if art-directed ever drifts in production. Strict's checker is a tighter guarantee of weight and size, at the cost of weaker ideas.
4. **Relaxed** in any container is dominated: it is no better looking than art-directed and the only level that failed.
5. **Round 1 tile** in any level: too loud and too round, as the owner said.

The choice between 1 and 2 is taste. Both are rendered in full. The recipe does not depend on the container, so switching later needs no regeneration.

## How it works in the app

Topic art is a client-only decoration, like titles. It never reaches Slack.

**Everything is a topic.**

- Threads get art from their title, channel, first message and latest message.
- Channel Main rows get art from the channel's name, purpose, topic and the latest few top-level messages.
- There are no separate channel marks.
- A DM's Main row keeps the person's photo, because that row is the person.
- A thread inside a DM gets art like any thread.

**When art is generated.**

- **Task.** A structured `topicArt` task in `@juno/ai` on Gemini 3.8 Flash. It runs in the background at the lowest priority.
- **Threads.** Art is generated once the thread's title resolves.
- **Mains.** Art is generated when the channel first enters the sidebar.
- **Timeout.** 10 s, against a measured p90 of 4.8 s. Nothing waits on it.
- **Backlog.** The first sync runs at a concurrency of 4.

**Caching.**

- **What is stored.** One row per topic in the durable user database: `topic_art(topic_id, task_version, input_hash, spec, hue, confident, source, created_at)`. `spec` is the canonical recipe, under 1 KB. `source` is `ai` or `redraw`.
- **Threads regenerate on title drift.** They follow the drift rule SPEC section 15 gives titles: a new input hash means a new drawing.
- **Mains regenerate on rename or purpose change.** Not on new messages: a channel's stream changes all the time, but what the channel is for rarely does.
- **Busy topics do not redraw.** A busy thread or channel never redraws on every message.

**Redraw.** "Redraw" in the row's context menu reruns the task, passing the previous recipe's hue and a one-line summary as things to avoid. It stores the answer with `source: redraw` and shows the usual undo toast. A background drawing already in flight cannot replace that redraw.

**The Tide placeholder.**

- **When it shows.** For every topic, Main or thread alike, whenever there is no art to show:
  - AI assist is off;
  - art is not generated yet;
  - the model answered `data-confident="false"`;
  - the drawing failed validation twice;
  - the call failed.

  Nothing in the row says which case it is.
- **Seeding.** Tide is seeded by topic id (thread ts or channel id), so it is stable and the same on every client.
- **Colour.** It uses the muted Tide tones in `palette.mjs`, tuned separately per theme.
- **Shape.** It occupies the same 40px box as the art. With no container (the decision) the bands are clipped to a free-form pebble picked per topic, about 30px across, so it weighs the same as a line drawing and is a shape among shapes, not a box among drawings. Inside a container it fills the container's box. Swapping never moves anything.
- **Cross-fade.** When art arrives for a row on screen, the art fades in over the placeholder in 240 ms, ease-out, opacity only. Under `prefers-reduced-motion` it swaps instantly. Art that is already cached paints directly, with no fade.

**Theme handling.**

- **CSS variables, not hex.** The renderer writes role colours as CSS variables, for example `var(--art-teal-ink)`. The light and dark values from `palette.mjs` go into `@juno/tokens`:
  - 8 hues × 6 roles (ink, soft, accent, accent2, subtle, plus the tile role if it is kept);
  - 8 hues × 5 Tide tones.
- **Theme switches.** One SVG string serves both themes, and a theme switch repaints through CSS without re-rendering the list.
- **Accent colour.** The user's accent colour does not touch the art.

**Rendering.**

- **Where.** A pure function in a small package (`@juno/topic-art`, no React, no Effect): `(spec, size, container) → SVG string`, as in `vocab.mjs` here.
- **Memoising.** `TopicArt` in `@juno/ui` renders it inline, memoised on spec hash, size and container.
- **Small sizes.** Below 20px, the renderer:
  - drops the container;
  - drops elements marked `detail="1"`;
  - thickens the stroke by 30%.
- **Sizes in use.** The tab icon (16px), header icon (20px) and row tile (40px) all come from one recipe.
- **Performance.** Drawings have 3 to 10 elements, with no gradients or filters. The per-row cost is a string lookup, inside the list budgets in `docs/performance.md`.

**Sanitising.**

- **No sanitiser.** There is no HTML sanitiser and there should not be one.
- **A whitelist parse.** The validator in `vocab.mjs` is a whitelist parse:
  - seven shape tags and `g`, each with its own attribute list;
  - numbers within ±60;
  - path data and transforms matched against a grammar;
  - colours only as role tokens;
  - no text content.
- **Rebuilt markup.** The markup is rebuilt from the typed spec, so a string the grammar did not match never reaches the DOM. Only the canonical spec is stored.
- **Same check for all levels.** Art-directed relaxes the composition rules, not this check.

**The AI-off switch.**

- Turning AI assist off (SPEC section 15) stops the task and shows Tide everywhere.
- Stored rows stay, so turning it back on is instant and free.
- "Clear AI data" deletes the rows along with the AI titles.

**Cost.**

- **Per icon.** About $0.0058, so $1.73 per 300 topics. That is far more than round 1's motif kit ($0.0002 on Haiku). Gemini's reasoning tokens are most of it.
- **Backlog.** The real workspace's 452 sidebar rows would cost about $2.60, once.
- **After the backlog.** Cost follows new topics and title drift only.
- **Controls:**
  - only topics that enter the sidebar get art;
  - one retry, no second model;
  - a per-workspace daily cap of 500 calls, with Tide as the fallback;
  - the backlog stops when AI is switched off.
- **Prompt caching.** The art-directed system prompt is about 1,000 tokens and identical on every call, so OpenRouter prompt caching for Gemini should cut the input part. Measure once wired.

**Spec edits when adopted.**

- SPEC section 5's tile rule becomes:
  - topic art for threads and channel Mains;
  - the person's photo for a DM's Main;
  - the Tide mark when there is no art.
- SPEC section 15 gains a row: Topic art, Generation, with the title and on drift, Tide when not confident.
- The row context menu gains "Redraw".

## Re-running

From this folder:

```sh
node run.mjs --level strict|relaxed|art [--force] [--pass N]
node build-sheet.mjs --top art/subtle,art/none
node render.mjs
```

- **`run.mjs`.** Calls OpenRouter with the key from the main checkout's `.env`, through `../openrouter.mjs`, and appends every batch's cost to `spend.log`.
- **`build-sheet.mjs`.** Rebuilds `results.js` and `stats.md`.
- **`render.mjs`.** Screenshots each section of `sheet.html` to a PNG, one browser at a time.

Changing the palette, containers or Tide needs only the last two commands. No model calls are needed.

## Spend

Total OpenRouter spend for round 2 is $1.04, summed from the cost OpenRouter reported on every call (`spend.log`): two passes of 35 topics at three levels. The cap was $5. The final palette, container and placeholder changes, including the pebble, needed no model calls.
