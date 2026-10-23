# Post-send grammar model study

## Change, 10-17

The owner asked for grammar to run after sending, not while typing, and for
slower answers to still show. The one-second window is gone: the request now
starts once the send is accepted, for the text sent, with a 20 s deadline, and
its fixes show on the sent message whenever they come within two minutes
(SPEC section 8). Typing pauses no longer start a request. The result below
still decides the model; the timings no longer decide whether a fix shows.

## Result, 10-16

The owner's goal then: grammar is checked after sending, is never intrusive, shows
only within one second of sending and only while he is still on the topic, and
messages over 1,000 characters are ignored.

The live benchmark ran on 10-16 with the owner's OpenRouter key: two rounds over
the 40 labelled cases below. No model gave a full answer in under one second.
GPT-6 Luna was kept: it made no wrong edit, and it was the cheapest.

| Model | Full answer p50 | Precision | Recall | Kept |
| --- | --- | --- | --- | --- |
| GPT-6 Luna (`openai/gpt-6-luna`) | 1.39 s | 100% | 68% | Yes: no false positives, cheapest |
| Other candidates (list below) | over 1 s | not recorded here | not recorded here | No |

Only Luna's figures were reported back from that run; p95, raw counts, error
counts and the other models' rows were not, so they are not filled in. With
no model inside the window, a request started after sending cannot usually
answer in time. So the request now starts when typing pauses (debounced,
cached by exact text, stopped when the text changes), with a 3 s deadline,
and the second after sending reads the answer that is usually there already.
The 700 ms qualification below, written for a request started after sending,
no longer decides the model.

## Method, written before the live run

2026-10-16. The first attempt was blocked: the engine environment had no
`OPENROUTER_API_KEY`. The candidates, from the
[OpenRouter model catalogue](https://openrouter.ai/api/v1/models) checked on
2026-10-16. Flash 3.8 and Flash-Lite 3.5 are the newest non-preview models in
those families. Earlier Flash versions and GPT-4.1 Nano provide small-model
comparisons.

- GPT-6 Luna (`openai/gpt-6-luna`)
- Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`)
- Gemini 3.8 Flash (`google/gemini-3.8-flash`)
- Gemini 3.7 Flash (`google/gemini-3.7-flash`)
- Gemini 3.5 Flash-Lite (`google/gemini-3.5-flash-lite`)
- Gemini 3.1 Flash-Lite (`google/gemini-3.1-flash-lite`)
- GPT-4.1 Nano (`openai/gpt-4.1-nano`)

Run `bun run --cwd packages/ai grammar:bench` with the same environment key the engine receives.
The script never prints the key or provider error bodies. It uses the production
provider, prompt, protected-text masking, output schema and edit filter. Requests
have one attempt and at most 256 output tokens. The measurement deadline is ten
seconds so slow full answers remain measurable; production stopped at 3 s until 10-17 and stops at 20 s since.

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

`bun run --cwd packages/ai grammar:bench --fake` passed 40/40, with all 20 clean examples unchanged
and all 20 corrections exact. This checks fixtures and validation only. Fake
latency is not a model result and is excluded from the table.
