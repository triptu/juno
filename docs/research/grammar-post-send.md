# Post-send grammar model study

2026-10-16. Live measurement is blocked: the engine environment has no
`OPENROUTER_API_KEY`. The private key-entry tool also failed to connect to T3.
No latency, precision or recall figures below are invented. No model has qualified.
The existing decision default, `openai/gpt-6-luna`, remains **provisional**.

The [OpenRouter model catalogue](https://openrouter.ai/api/v1/models), checked on
2026-10-16, lists these candidates. Flash 3.8 and Flash-Lite 3.5 are the newest
non-preview models in those families. Earlier Flash versions and GPT-4.1 Nano
provide small-model comparisons.

| Model | Full answer p50 | Full answer p95 | Precision | Recall | Status |
| --- | --- | --- | --- | --- | --- |
| GPT-6 Luna (`openai/gpt-6-luna`) | — | — | — | — | Needs key |
| Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`) | — | — | — | — | Needs key |
| Gemini 3.8 Flash (`google/gemini-3.8-flash`) | — | — | — | — | Needs key |
| Gemini 3.7 Flash (`google/gemini-3.7-flash`) | — | — | — | — | Needs key |
| Gemini 3.5 Flash-Lite (`google/gemini-3.5-flash-lite`) | — | — | — | — | Needs key |
| Gemini 3.1 Flash-Lite (`google/gemini-3.1-flash-lite`) | — | — | — | — | Needs key |
| GPT-4.1 Nano (`openai/gpt-4.1-nano`) | — | — | — | — | Needs key |

Run `pnpm --filter @juno/ai grammar:bench` with the same environment key the engine receives.
The script never prints the key or provider error bodies. It uses the production
provider, prompt, protected-text masking, output schema and edit filter. Requests
have one attempt and at most 256 output tokens. The measurement deadline is ten
seconds so slow full answers remain measurable; production stops at 700 ms.

The labelled set in `packages/ai/eval/grammar-cases.ts` has 40 invented short
messages: 20 clean and 20 with errors. It includes lowercase style, slang,
confusables, missing words, doubled words, verb agreement, code, quotes, links
and mentions. There is one unscored warmup per model, five rounds, rotated model
order, and one outstanding request. Timers surround the whole provider call,
including the complete streamed answer and validation, not just the first token.
Connections are reused by the provider; upstream connection reuse is controlled
by OpenRouter. Record the client region and routing alongside live results.

Precision is exact correct corrections / all messages changed. Recall is exact
correct corrections / all labelled messages needing a correction. A wrong edit
counts as a false positive and, on an erroneous message, a missed correction.
Transport, timeout and invalid-output errors are reported separately; they count
as misses on erroneous messages and cannot qualify as fast successful answers.
Latency percentiles include complete validated answers only; the errors column
must be zero to qualify. Report raw counts as well as percentages when filling
this table.

Qualification: zero observed false positives, zero request errors, at least 80%
recall, and full-answer p95 at most 700 ms. Pick the lowest p95 among qualifiers.
Forty examples remain a small sample: zero observed false positives is not proof
of zero production errors. If none qualifies, report that rather than naming an
unmeasured winner. Jev is not benchmarked for span edits because its classifier
output cannot produce replacement words; existing local rules need no model.

`pnpm --filter @juno/ai grammar:bench --fake` passed 40/40, with all 20 clean examples unchanged
and all 20 corrections exact. This checks fixtures and validation only. Fake
latency is not a model result and is excluded from the table.
