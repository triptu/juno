# @juno/ai

Provider isolation. The `AiProvider` Effect service, its two implementations (`PiAiProvider` over pi-ai and OpenRouter, `FakeAiProvider` for tests), and the task table: one row per AI feature in SPEC section 15, each with its prompt, input shape, output schema, tier and timeout. See `docs/architecture.md` section 10 and ADR 0006.

Plain data in, plain data out. The package never touches the store, Electron or disk, and never reads the key from the environment; the engine hands it the key in memory.

## Public API

- `AiProvider`: the service. `decide(task, input)` runs a structured task and resolves to a `Decision<Output>`. `generate(task, input)` runs a text task and resolves to a `Decision<string>`. Nothing fails: every effect has error type `never`. The Juno chat is not here: it is the Juno Agent (`@juno/agent`), which runs in its own process.
- `Decision<A>`: `{ _tag: 'Decided', value, meta }` or `{ _tag: 'NoDecision', reason, detail?, kind?, meta }`. Reasons: `missing-key`, `timeout`, `invalid-output`, `provider-error`, `budget`. A `provider-error` has `kind`, an `AiFailureKind`. `meta` has the model slug, latency, attempts and the cost in USD when pi-ai knows the model's price, and `fallbackFor` (the main model's failed call: its meta, kind and detail) when the fallback model answered. `isFinal(decision)` says the same input will fail the same way, so a job keeps it and does not send it again until the input changes.
- The error kinds of `@juno/ai-failure`, re-exported: `classifyFailure(text)`, `isRetryable(kind)`, `fallbackHelps(kind)`, `refusedBeforeOutput(text)` and `modelMaker(slug)`. They live in that leaf package so the agent's guard sorts errors the same way without depending on this one.
- `tasks`: `titleTopic`, `routeCheck`, `grammarCheck`, `settledScore`, `notificationReading`, `instructionRule`, `parseCommand`, `topicArt`, `followUps`, `homeTitle`. Each is a `StructuredTask` (has `output`, a TypeBox schema, and `tool`; optionally `classify`, a decision-model mapping) or a `TextTask` (has `maxChars`, and may have `check`, a validation that can rewrite the text to a canonical form, and `retry`, the message a retry sends with the failure's reason). All have `name`, `version`, `tier`, `timeoutMillis`, `prompt`, `render(input)` and `key(input)`. `decisionTasks` lists the structured ones.
- `cacheKeyOf(task, input)`: `{ task, key, inputHash }` for the assistant's `ai_cache`. The hash covers the task version and the canonical input (sorted keys, `undefined` dropped), so equal inputs hash the same and a prompt change is made visible by bumping `version`.
- `validateOutput(task, input, args)`: the schema check (pi-ai's validator) plus the task's `accept` rule and optional `clean` filter for individual findings. Both providers use it, for tool calls and for classifier answers.
- `PiAiProvider.layer(config, models?)`: `config` is an `Effect<AiConfig>` read on every call, so a key or model added in preferences applies without a restart. `AiConfig` is `{ apiKey?, models?: { classifier?, decision?, generation?, art? }, admit? }`. With `admit`, every call first reserves its upper cost (`upperUsd`: every input byte as a token at the dearest input rate, the retry's copy of the answer, both outputs at the cap; $0.05 for a slug outside the price table) and gets `budget` with no request when the cap refuses; afterwards it settles the reported cost, zero for a 401, 403 or 429, at the first attempt's bound for a timeout or a lost request in the first attempt (the retry was never sent), and unknown (the whole reservation is kept) for one in the retry or an unpriced model. `FakeAiProvider.layerWith({ admit })` asks the same with the upper cost at the fake's prices ($1 in, $4 out per million tokens, about four characters a token), and settles the cost its answer reports at those prices. `defaultModelPrefs` holds the default slugs.
- `FakeAiProvider.layer`, `makeFakeAiProvider()`: deterministic. Select it with `JUNO_AI=fake` in the engine (that wiring is the assistant's job). `FakeAiProvider.layerWith({ delayMillis })` answers that late and, like the real provider, gives no decision (`timeout`) past the task's timeout; e2e launches set it with `fakeAiDelayMillis` to watch a slow model.
- `Type`, `Static`: TypeBox, re-exported so the assistant can declare tool parameters without importing pi-ai.

Ids in outputs are plain strings. The `accept` rule of each task guarantees they point into the input, so the caller may brand them.

## What it decides

- **Four model slots.** `classifier` is a System One decision model for the decision tasks that carry a `classify` mapping (`routeCheck`, `settledScore`, `notificationReading`). `decision` is a small chat model for the decisions a classifier cannot make because they extract text or ids (`parseCommand`, `instructionRule`). `generation` is the stronger chat model for text. `art` is the model that draws topic art (`topicArt`), chosen in the design study (`docs/design/topic-art/v2`). An empty `classifier` slug sends every decision to the chat `decision` model.
- **Tier and shape are separate.** `tier` picks the model and the default timeout. Shape is structured or text, on any tier.
- **A classifier decision is one System One request.** The task's `classify.ask(input)` builds a JSON state and typed questions (a choice among Main and the topics; a bool for settled; for a notification, a choice among the owner's instructions and none, and a choice of what the message needs); `classify.read(answers)` turns the answers into the task's raw output, which goes through the same `validateOutput` as a tool call. Probabilities come from the model, not from prose.
- **A chat decision is one tool call.** The task's output schema is the tool's parameters. On the decision tier pi-ai forces that tool (`tool_choice` by API: Anthropic `{ type: 'tool' }`, OpenAI-compatible `{ type: 'function' }`). On the generation tier the tool choice is `auto` and the prompt asks for the call, because Sonnet 5.5 on OpenRouter rejects a forced choice (`tool_choice: type "tool" and "any" are not supported for this model`). If any model rejects a forced choice, the retry asks with `auto`. The arguments are validated, then `accept` runs.
- **One retry inside the task's timeout, only when it can help.** An invalid answer, or a provider error of a retryable kind (network, timeout, rate limit, unavailable, server, unknown), is retried once. A policy refusal, a bad request, a context too long, an unknown model, a key or credits error is not; the one exception is a 400 about a forced `tool_choice`, which the retry asks again with `auto`.
- **A fallback from another maker.** When a chat call ends in a policy refusal, or with the model not found or unavailable, and `models.fallback` (default `google/gemini-3.8-flash`; '' for none) is by another maker than the model (`modelMaker`), the provider asks it once in the time the task has left (not under 0.5 s), with its own reservation and settlement. Not for art, whose model was chosen for drawing, nor for the classifier path. A second call, not OpenRouter's `models` list: OpenRouter would fall back on any error, including ones a retry fixes, and pi-ai would price and reserve the answer at the main model's rates. A text task with `retry` continues the conversation on that retry (the failed answer, then the retry message with the reason), so the model corrects one thing; `topicArt` quotes the checker's reason this way. Anything else is `NoDecision`.
- **The provider enforces the timeout.** The task table carries the number; the provider ties it to the request's `AbortSignal` so a slow call is cancelled, not just ignored. pi-ai's own HTTP retries are off (`maxRetries: 0`), so the task's retry and timeout are the only ones.
- **The first call does not pay for module loading.** `openRouterModels()` starts the imports of pi-ai's lazy chat API modules (the OpenAI and Anthropic SDKs) in the background; on a busy machine those take seconds and would eat a decision's budget. After the first paint, the engine sends one unbilled HEAD to OpenRouter's models endpoint when AI assist is on and a key is set. This warms DNS and TLS in the decision process; an idle connection may still expire before a later decision.
- **Reasoning is off.** Anthropic models get `thinkingEnabled: false`. OpenAI-compatible models get reasoning `none` through pi-ai, or the lowest level the model allows (`minimal`, else `low`) when it cannot be turned off.
- **Unknown slugs still work.** A chat slug missing from pi-ai's catalogue is sent as an OpenAI-compatible model, a classifier slug as a System One model; the cost is then unknown and `meta.costUsd` is absent.
- **Topic art is a text task that checks its text.** `topicArt` renders a thread (title, channel, first and latest message) or a channel's Main (name, purpose, topic, recent messages) into the art-directed brief from the study, and its `check` is `@juno/topic-art`'s `parseRecipe`: the output is the canonical recipe rebuilt from the checked drawing, never the reply's bytes. `data-confident="false"` in it is the model saying it had nothing to draw. An `avoid` on the input (the previous hue and a one-line summary) asks a redraw to differ.
- **Notification decisions.** `notificationReading` is Auto's last step (SPEC 14). It reads the new message, the thread's first message, up to 10 earlier messages with the owner's marked, facts about the conversation and the owner's instructions, and asks two choice questions: `instruction` (only when there are instructions: one option per instruction, "The main point of this message is: …", and `none`) and `needsYou` (`ask`, `answer`, `follow_up`, `decision`, `serious`, `greeting`, `fyi`, `chatter`). It returns the answers as they came (`needsYou`, its probabilities, and the chosen instruction with its confidence, or null); the thresholds are named constants in `@juno/domain`, which `decideNotification` applies. Two seconds; the engine decides without it after that. `instructionRule` runs once when the owner adds an instruction, on the chat `decision` model: given the people and channels the instruction names, it returns `{ kind, id, level }` when the instruction is really a person or channel level, else null. The fake reads an ask (a question, "can you", approve, review) before a greeting, so "hey! can you approve the contract by 3?" is an ask, and matches an instruction by shared words, a greetings instruction only to a bare greeting and a social one only to chatter.
- **Home's two tasks.** `followUps` reads a topic's latest messages and returns the user's own promises that nothing later says are done, each as one line starting "You said you'd" and pointing at the user's message (`accept` refuses any other message). `homeTitle` rewrites the title line of a Home item the rules already found (waiting, resume, moved) and says whether it is confident; it is a structured task on the generation tier so a missing or unsure answer leaves the plain title. The fake finds "I'll …" and "I will …" in the user's messages and drops one followed by a closing message of theirs; its titles are "<Name> asks: …", "Pick up where you left off: …" and "<topic> grew N replies".
- **Titles leave out sensitive details.** `titleTopic` (version 2) names pay, firing, health, legal matters, criticism of a person, secrets and contact details neutrally ("Comp discussion for Donna", not "Go with 100k for Donna") and keeps every other title specific. The model judges; there is no word filter. AI titles made before the rule stay as they are: nothing titles them again.
- **Prompts are code.** `src/tasks/<task>.prompt.ts` next to each task, plain template strings; the classifier instructions and criteria live in the same file. Shared rules in `src/tasks/shared.ts`: plain text, no markdown or emoji, never write for the user, quiet option when unsure.
- **The fake refuses on cue.** Input that holds `::refuse::` (`FAKE_REFUSE`) is refused under the model's policy (`kind: 'policy'`, settled at nothing); `FakeAiProvider.layerWith({ fallback })` then answers it as that slug, with `fallbackFor`, except for art.
- **The fake validates too.** Word rules in `src/fake/rules.ts`. Their output goes through `validateOutput` and a text task's `check`, so a broken rule is a `NoDecision` in a test, never a crash. The fake's `topicArt` picks an object by words in the topic and a hue by hash, marks a very short title not confident, steps to the next hue and object on a redraw, and answers outside the vocabulary when the text contains `::invalid-art::`, so tests can see what the app does with a drawing that fails.

## Defaults and timeouts

`typesafe/jev-1.13` for the classifier, `openai/gpt-6-luna` for chat decisions, `anthropic/claude-sonnet-5.5` for generation, `google/gemini-3.8-flash` for topic art and as the fallback (another maker than the chat defaults, $0.75 in and $3.75 out per million). Preferences override them; the fallback comes from Settings › Juno through the agent.

Each task's deadline, and why, is in `docs/architecture.md`, "AI call deadlines". Background tasks have generous ones (20 to 60 s); `notificationReading`, `parseCommand` and Redraw keep short ones because someone waits.

## Measurements

`bun run --cwd packages/ai bench` on 2026-10-13, from a laptop in Europe (HTTPS round trip to OpenRouter about 0.25 s, so no setup can beat that) that other work kept at a load average above 100, so absolute times are pessimistic by a few hundred milliseconds; the setups ran side by side, so the comparison holds. Every setup runs the structured examples in `eval/examples.ts` with their `expect`; accuracy counts a run as right only when it decided and the judgement matched. Classifier rows cover the 3 mapped tasks (60 runs); chat rows cover all 6 structured tasks (66 to 99 runs). Cost is pi-ai's catalogue price per 1k decisions.

| Setup | p50 | p95 | Accuracy | No decision | USD per 1k |
| --- | --- | --- | --- | --- | --- |
| `typesafe/jev-1.13`, classify | 516 ms | 930 ms | 100% | 0% | 0.032 |
| `~typesafe/jev-latest`, classify | 511 ms | 891 ms | 100% | 0% | 0.032 |
| `liquid/d1`, classify | 678 ms | 897 ms | 100% | 0% | 0.020 |
| `perplexity/pplx-decider-v1.1-27b`, classify | 577 ms | 871 ms | 95% | 0% | 0.012 |
| `openai/gpt-6-luna-decisions`, classify | 600 ms | 910 ms | 95% | 0% | 0.056 |
| `cloudflare/clef-flash`, classify | 1100 ms | 1940 ms | 97% | 0% | 0.050 |
| `jaredpalmer/kev-4b`, `upstage/solar-decide`, `respan/span-01` | | | 72%, 60%, 0% | | |
| `openai/gpt-6-luna`, forced tool | 1711 ms | 3469 ms | 95% | 2% | 0.065 |
| `openai/gpt-6-luna`, `provider.sort` latency or throughput | 1650 ms | 2650 to 3300 ms | 98 to 100% | 1% | 0.064 |
| `openai/gpt-6-luna`, tool choice auto | 1777 ms | 3272 ms | 96% | 1% | 0.064 |
| `openai/gpt-6-luna`, trimmed prompt | 1871 ms | 4728 ms | 93% | 2% | 0.056 |
| `openai/gpt-6-luna`, JSON schema response | 1598 ms | 3173 ms | 58% | 39% | 0.030 |
| `openai/gpt-6-luna`, not streamed | 1508 ms | 3083 ms | 99% | 0% | 0.066 |
| `openai/gpt-6-luna`, streamed: first event 693 ms, tool call complete 1531 ms | 1534 ms | 2934 ms | 98% | 1% | 0.066 |
| `qwen/qwen3.7-flash`, forced tool | 1091 ms | 2931 ms | 89% | 6% | 0.032 |
| `mistralai/ministral-8b-2512`, forced tool | 922 ms | 3136 ms | 88% | 6% | 0.046 |
| `anthropic/claude-haiku-5.5`, forced tool | 1758 ms | 3750 ms | 86% | 11% | 0.085 |
| `google/gemini-3.1-flash-lite` | 1464 ms | 2959 ms | 86% | 3% | 0.209 |
| `z-ai/glm-5.3-flash` | 2163 ms | 10068 ms | 86% | 8% | 0.166 |
| `deepseek/deepseek-v4-flash` | 3512 ms | 8308 ms | 83% | 9% | 0.126 |
| `inception/mercury-2.5` | 2459 ms | 9073 ms | 79% | 20% | 0.202 |
| `amazon/nova-micro-v1` | 957 ms | 2399 ms | 76% | 8% | 0.043 |
| `nvidia/nemotron-3.5-lightning` | 1108 ms | 2849 ms | 73% | 17% | 0.042 |
| `google/gemini-2.5-flash-lite` | 1150 ms | 5552 ms | 67% | 18% | 0.071 |
| `google/gemma-4-26b-a4b-it`, `upstage/solar-mini4`, `meta-llama/llama-3.1-8b-instruct`, `openai/gpt-4.1-nano`, `openai/gpt-5-nano` | 364 to 2158 ms | | 44 to 64% | 21 to 38% | |

What the numbers say:

- A decision model is both the most accurate and the fastest path: Jev answered every mapped example right at twice the network floor, for a third of a cent per 1k. Chat models trail on both axes because a tool call is 50 to 150 output tokens; with Luna the first token arrives at 0.7 s and the call completes at 1.5 s, whether streamed or not.
- OpenRouter's `provider.sort` hints, a trimmed prompt and prompt caching do not move the chat-model number: the prompts are 150 to 300 tokens, below Anthropic's cacheable minimum, and the time is in the output. Strict JSON schema output fails on the union-typed output of `parseCommand`, so tool calls stay.
- Luna is the only small chat model that got every `groupRun` and `parseCommand` example right (36 of 36 over three reps). Haiku 5.5 missed a third of the command examples and was no faster.
- Among chat models with better latency, `ministral-8b-2512` and `qwen3.7-flash` are a fair cheaper trade (about 0.9 to 1.1 s at 88 to 89%) if correctness on grouping and commands matters less than speed.

## Eval and bench

`bun run ai:eval` runs every task on invented examples (`eval/examples.ts`) with the fake and prints each output. Structured examples carry `expect`, so the summary line counts how many judgements matched. `JUNO_AI=live bun run ai:eval` uses OpenRouter with `OPENROUTER_API_KEY` from the environment or the repo's `.env`, and prints latency, cost and attempts. Without a key it says so and exits 0. `bun run ai:eval routeCheck` runs one task. `JUNO_AI_CLASSIFIER_MODEL` (empty for none), `JUNO_AI_DECISION_MODEL` and `JUNO_AI_GENERATION_MODEL` try other slugs for a run.

`bun run --cwd packages/ai bench` measures setups (a model plus request options: forced tool, tool choice auto, JSON schema, `provider.sort`, trimmed prompt, raw non-streamed, streamed with time to first event, or classify) on the structured examples: `--reps`, `--setups a,b`, `--tasks a,b`, `--concurrency`, `--list`. Tool setups run through `makePiAiProvider`, so they measure the real code path. It is live only and costs a few cents per full run.

`bun run --cwd packages/ai eval:title-privacy` titles invented threads (`eval/title-privacy-cases.ts`: pay, firing, layoffs, performance, health, legal, complaints, venting, secrets, contact details, and ordinary topics that must stay specific) with the `titleTopic` prompt before the sensitive-details rule and with the current one, and flags a title that leaks a listed detail or, for an ordinary topic, has none of its words. `JUNO_AI=live` runs it on OpenRouter; `--after` runs only the current prompt. On 2026-10-17 with Sonnet 5.5, the old prompt passed 15 of 23 and the current one 23 of 23, for $0.04 both together.

## Tests

`bun run --cwd packages/ai test`. `test/pi.test.ts` runs `PiAiProvider` against pi-ai's scripted faux provider plus a scripted System One classifier: a valid call, a retry after output that names a topic, person, channel, instruction or message not in the input (the `accept` rules), two invalid answers, provider error, missing key, tool choice by tier and the `auto` fallback, classifier questions and answers, classifier off, no retry of a refusal, the fallback model and its reservation. The timeout runs on Effect's `TestClock`, and the timeout and interrupt cases wait for the request to reach the faux model, so no case depends on real time. `test/grammar.test.ts` covers the grammar filter and `test/cacheKey.test.ts` cache key stability. The fake is tested through the e2e specs that run on it. No test depends on prompt wording.

## Open questions

- Calibration: Jev's probabilities are not yet checked against the thresholds the assistant will use (the eval tests direction, not calibration). Collect a few hundred real decisions before fixing thresholds.
- `parseCommand` returns the intent (`kind`, target id, text) and a confidence; building the domain `Command` with its label and hint from that intent is a domain helper that does not exist yet.
- Outputs return ids as plain strings; branding them at the boundary is left to the caller.

## Must not

- Import the store, the engine, Electron or `@juno/contract`. The `@juno` dependencies are `@juno/domain`, for types, `@juno/topic-art`, the vocabulary `topicArt` checks its output against, and `@juno/ai-failure`, the error kinds.
- Read the key from disk or the environment. Only `eval/run.ts` and `eval/bench.ts` read `OPENROUTER_API_KEY`, and only for the manual eval and bench.
- Hard-code a model slug anywhere but `defaultModelPrefs` (and the bench's setup list).
- Throw. A failure is a `NoDecision` or a `failed` event.

`grammarCheck` uses the `decision` chat model (currently GPT-6 Luna, provisional pending the grammar benchmark): a classifier cannot return span edits. One attempt, at most 256 output tokens, 700 ms deadline. Spelling corrections cover one word within two letter edits, preserving case; the prompt excludes synonyms, slang and abbreviations. The structured edit schema rejects rewrites, case and punctuation changes, overlaps and protected spans. Code, quotes, links and mentions are masked before the request. Messages over 1,000 Unicode characters are skipped. The post-send overlay opens an unsaved inline edit draft; it never sends a correction automatically.

`bun run --cwd packages/ai grammar:bench --fake` checks the 40 labelled fixtures (20 clean, 20 with errors). `bun run --cwd packages/ai grammar:bench` uses the engine's `OPENROUTER_API_KEY` environment variable for five rounds through OpenRouter, one warmup per model and one request at a time. It reports full-answer p50/p95, errors, exact-correction precision and recall, and known cost. See [the study](../../docs/research/grammar-post-send.md).
