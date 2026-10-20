# @juno/highlight

Syntax colours for code blocks (SPEC section 7, "Code blocks"). A block's text and an optional language go in; a flat list of coloured tokens comes out. The tokenizer is [highlight.js](https://highlightjs.org) 11 through [lowlight](https://github.com/wooorm/lowlight) 3, which gives its result as a tree instead of HTML. Language detection is Juno's own. No Effect, no React, no other `@juno` package. Decision 0017 records the choice and its measurements.

## Entry points

The package has three entry points, because their costs differ.

| Import | What it holds | Size, minified | Who imports it |
| --- | --- | --- | --- |
| `@juno/highlight` | `SyntaxKind`, `CodeToken`, `HighlightedCode`; `languageOfTag(tag)`; `splitLanguageTag(text)` | 1.5 KB | `@juno/richtext` |
| `@juno/highlight/highlight` | `highlightCode(code, language?)` (with `detectLanguage` from `src/detect.ts`), `MAX_HIGHLIGHT_LENGTH`, and 29 grammars | 154 KB (48 KB gzip) | the desktop renderer's highlight worker, the gallery, tests |
| `@juno/highlight/paint` | `paintCode(element, highlighted)` | under 1 KB | the desktop renderer's painter chunk, the gallery |

`scripts/check-deps.mjs` fails on any other import of `/highlight`, `highlight.js` or `lowlight`, so the grammars never reach the start bundle.

## Rules it decides

- **The tag line.** `splitLanguageTag` reads a first line that holds only a known tag (`ts`, `Python`, `sh`, `text`) as the language, the Discord convention, and drops that line. Anything else on the line, or no code after it, leaves the block as written. `text`, `txt` and `plain` mean "no colours". The tags are in `TAGS` in `src/index.ts`; values are highlight.js grammar names.
- **Detection** (`src/detect.ts`). Wrong colours read worse than none, so it answers only when the text is clearly one language. First it rules out shapes people paste as text: stack frames, tracebacks, compiler and test output, HTTP headers, git and docker output, and text where half the lines are log lines. JSON is anything `JSON.parse` takes that is an object or array. A block whose every line is a known shell command is `bash`, or `shell` with `$ ` prompts. Other languages score weighted clues, and the best one wins only with a score of 4 or more and 1.5 times the runner-up's. Text that reads as sentences needs 7. JavaScript is detected as TypeScript, whose grammar covers it. Detected: TypeScript, Python, SQL, JSON, shell, Go, Rust, YAML, diff, CSS, HTML and Java. Tagged only: C, C++, C#, Kotlin, Swift, Ruby, PHP, Dockerfile, INI and TOML, Markdown, GraphQL, Makefile, Lua, SCSS and Less.
- **Tokens.** `highlightCode` flattens highlight.js scopes to thirteen kinds (`KINDS` in `src/highlight.ts`). Each kind has a `--syntax-<kind>` token in `@juno/tokens`. Joined, the tokens' text is the code exactly. Only the first `MAX_HIGHLIGHT_LENGTH` (12,000) characters are coloured; the rest is one plain token.
- **Painting.** `paintCode` uses the CSS Custom Highlight API: one `Highlight` per kind, registered as `syntax-<kind>` and coloured by the `pre > code::highlight(syntax-*)` rules in `@juno/tokens/global.css`. It adds ranges over the element's text nodes and changes no element, so a coloured block has the plain block's layout. It paints nothing when the element's text is not the tokens' text. The function it returns takes the ranges off.

## Must not

- Import Effect, React or another `@juno` package.
- Write a colour. Colours are `--syntax-*` tokens.
- Change the text. Colouring is ranges over the text as drawn.

## Testing

`pnpm remote test --passWithNoTests test/tag.test.ts test/detect.test.ts test/highlight.test.ts`. The tests cover the tag line, detection on real-looking samples (TypeScript, Python, SQL, JSON and shell found; prose, stack traces, compiler errors, logs and letters plain) and tokens that keep the text. `apps/desktop/e2e/code-highlight.spec.ts` covers the whole path against the fake Slack.
