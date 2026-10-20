# 0017. Colour code blocks with highlight.js in a worker, painted as CSS highlights

Status: accepted, 2026-10-20. Built in `packages/highlight` and `apps/desktop/src/renderer/highlight/`.

## Context

Slack shows code blocks in one colour. Tushar wants syntax colours, as Discord has, in messages and in Juno's own bubbles (SPEC 7, "Code blocks"). Slack's `rich_text_preformatted` has no language field (the schema and `docs/research/` show none), so the language comes from a tag on the block's first line (```` ```ts ````, the Discord convention) or from detection. Slack users paste prose, logs and stack traces into code blocks as often as code, and wrong colours read worse than none.

The limits: the start bundle had 2.0 KB left (1,098.0 KB of 1,100 KB on `origin/main` at `512df355`). Nothing may load at startup. Opening a topic must not wait for colours, and scrolling must not drop frames. The code block is 150 px tall at most and scrolls, so about seven lines show.

## Measurements

On this Mac (Node 26 for the libraries, Chrome for painting), 13 languages each, minified:

| Library | Size (gzip) | Load | First block | 30 lines | 300 lines | Detection |
| --- | --- | --- | --- | --- | --- | --- |
| Shiki 4.5, JavaScript regex engine | 884 KB (148 KB) | 19 ms | 490 ms | 3.5 ms | 34 ms | none |
| highlight.js 11.12 | 74 KB (24 KB) | 5.5 ms | 19 ms | 0.30 ms | 3.0 ms | `highlightAuto`: 2.1 ms per 30 lines, 11 ms per 300 |
| lowlight 3.3 (highlight.js as a tree) | 76 KB (24 KB) | 5.3 ms | 19 ms | 0.25 ms | 2.4 ms | as highlight.js |
| Prism 1.30 | 40 KB (15 KB) | 4 ms | 7.7 ms | 0.17 ms | 1.5 ms | none |

Detection on 86 hand-written blocks of the kinds people paste (51 code in 12 languages; 35 prose, logs, stack traces, compiler errors, command output): highlight.js's `highlightAuto` at its best relevance threshold (5) got 60 right, left 16 plain and coloured 10 wrongly; at threshold 9 it got 47 right and 2 wrong. Juno's detector (`src/detect.ts`) got 85 right, 1 plain, 0 wrong. On 5,779 windows of 4 to 15 lines cut from this repo, it left 1,814 of 1,818 prose windows from `docs/` plain (the 4 it coloured hold code), and gave 2,463 of 3,961 TypeScript and JavaScript windows their language, 1,478 plain and 20 another language (0.5%, mostly SQL inside template strings and JSX coloured as HTML). Detection costs 9 µs a block on average and 0.23 ms for 300 lines.

The shipped module (29 grammars, detection, flattening) is 154 KB (48 KB gzip). A tagged 30-line block costs 0.29 ms, a detected one 0.34 ms, 300 lines 2.2 ms; the first block also compiles its grammar (19 ms). In Chrome, painting a 30-line block's 163 tokens as highlight ranges takes 0.23 ms, a 300-line block's 1,441 tokens 1.6 ms, and taking a block's ranges off 0.2 ms. Scrolling 300 rows that each hold a painted 30-line block at 2,000 px/s gave the same frames as unpainted rows (p95 16.7 ms at 60 Hz, no frame over 50 ms).

## Decision

- **highlight.js grammars through lowlight.** lowlight is highlight.js's supported way to get a tree instead of HTML, which `highlightCode` flattens into runs of thirteen kinds. It is ESM, has no globals and covers every language people paste. Shiki is the most accurate, but it is twelve times the size and too slow per block. Prism is the smallest and fastest, but its grammars register on a global `Prism`, and in a worker its core takes over the `message` handler unless a global flag is set first. Lezer would need a parser per language and has no detection.
- **Juno's own detection.** highlight.js's relevance scores rated prose and stack traces as high as real code, so its detection is not used. Juno's rules first rule out text shapes, then score weighted regular expressions. A language needs a score of 4 and 1.5 times the runner-up's, or 7 for text that reads as sentences. JSON is what `JSON.parse` takes. A block of known shell commands is shell.
- **The tag line is read in the engine.** `@juno/richtext` turns a first line holding only a known tag into the code block's `language` and marks it `tagLine`; the view leaves the line out. `text` keeps it, because the edit field, the fallback text and edits sent to Slack are built from `text`: a first version dropped it there, and saving an edit lost the tag. The plain block the renderer draws first already has its final lines, and the renderer needs no tag table.
- **A worker, started by the first block near the screen.** The start bundle holds a few hundred bytes: the view's effect and a stub that loads the painter chunk (2.6 KB) when a code block mounts. The painter waits with an IntersectionObserver (200 px margin) until the block is near the screen, and only then starts a module worker (156.9 KB) that runs `highlightCode`. The observer moved from the start bundle into the painter on 10-20 to keep the start bundle within its budget. The main thread never parses the grammars or tokenizes. Every block waits until it is near the screen, even one whose colours are known; a first version painted known blocks from a layout effect, off screen too, on every reopen. The painter keeps the last 300 answers and sends the worker one block at a time. At most 64 wait, the oldest giving up first, and a block that unmounts leaves the queue, so nothing holds a detached element. A block the worker has not answered in 3 s stays plain and the worker is replaced; after three such failures blocks stay plain for the run.
- **CSS Custom Highlight API instead of spans.** Tokens become `Range`s in one `Highlight` per kind, coloured by `code::highlight(syntax-*)` rules in `global.css` from the `syntax` tokens. The rules must name the code element. Written bare, `::highlight()` matches every element, and Chromium works out highlight styles for each one it restyles. In Chrome a restyle of 3,000 rows took 13.3 ms instead of 7.8 ms, and in the perf suite the elements styled per scroll frame went from 8 to 60 in a topic and from 26 to 121 in All topics. The renderer also kept 66 MB more after heavy use. Scoped rules cost nothing measurable (7.4 to 7.8 ms). With them the perf suite on this Mac matched `origin/main`: renderer 260 MB after heavy use (main 246 MB, budget 300), 10 and 26 elements styled per frame (main 8 and 26), no long animation frames, and topic scroll p95 6.3 ms (main 6.3 ms). The block stays one text node: colouring creates no element, changes no layout, causes no React render, and leaves selection and copy as on plain text. Spans would have meant a React render of up to thousands of elements per block on the main thread.
- **Long blocks.** Only the first 12,000 characters are coloured; the rest stays plain in the same text.

## Consequences

- Colours appear a moment after a block first scrolls near the screen; the first block of a run waits for the worker to start and compile its grammar (about 30 ms). The block never moves.
- The start bundle grew by 0.9 KB of JS (1,098.0 to 1,098.9 KB) and 1.6 KB of CSS (151.6 to 153.2 KB): the `::highlight` rules, the `syntax` variables in light and dark, and the no-ligatures rule.
- `scripts/check-deps.mjs` keeps the grammars to the worker: only `packages/highlight/src/highlight.ts` imports `highlight.js` and `lowlight`, only the worker entry (and the gallery, a separate review app) imports `@juno/highlight/highlight`, nothing in `packages/highlight/src` re-exports it, nothing imports the worker module, and the renderer imports the painter only with `import()`.
- The composer can colour code later with the same `highlightCode`, and with `paintCode` on a contenteditable. A `<textarea>` cannot hold highlight ranges.
- Tests read colours from `CSS.highlights`, not from computed styles (`apps/desktop/e2e/code-highlight.spec.ts`).

## Alternatives

- **Shiki, Prism, Lezer**: see Decision.
- **highlight.js's `highlightAuto`**: wrong colours on prose and stack traces (Measurements).
- **Coloured spans rendered by React**: a main-thread render per block, many DOM nodes in long blocks, and a separate cap on what is coloured.
- **Tokenizing on the main thread in idle time**: the first grammar compile alone is 19 ms, more than two frames at 120 Hz.
- **Tokens in the engine's view model**: larger live-query payloads (snapshot budget 200 KB) for every code block in the window, coloured or not on screen.
