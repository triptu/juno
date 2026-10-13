# @juno/ai

Provider isolation. The `AiProvider` Effect service, its two implementations (`PiAiProvider` over pi-ai and OpenRouter, `FakeAiProvider` for tests), and the task table: one row per AI feature in SPEC section 15, each with its prompt, input shape, output schema, tier and timeout. See `docs/architecture.md` section 10 and ADR 0006.

Plain data in, plain data out. The package never touches the store, Electron or disk, and never reads the key from the environment; the engine hands it the key in memory.

## Public API

- `AiProvider`: the service. `decide(task, input)` runs a structured task and resolves to a `Decision<Output>`. `generate(task, input)` runs a text task and resolves to a `Decision<string>`. `chat(context, tools)` streams one Juno chat turn as `ChatEvent`s (`text`, `toolCall`, then `done` or `failed`). Nothing fails: every effect has error type `never`, and a stream ends with `failed` instead of an error.
- `Decision<A>`: `{ _tag: 'Decided', value, meta }` or `{ _tag: 'NoDecision', reason, detail?, meta }`. Reasons: `missing-key`, `timeout`, `invalid-output`, `provider-error`. `meta` has the model slug, latency, attempts and the cost in USD when pi-ai knows the model's price.
- `tasks`: `titleTopic`, `routeCheck`, `settledScore`, `groupRun`, `urgencyGate`, `parseCommand`, `catchUp`, `forYou`, `chat`. Each is a `StructuredTask` (has `output`, a TypeBox schema, and `tool`) or a `TextTask` (has `maxChars`). All have `name`, `version`, `tier`, `timeoutMillis`, `prompt`, `render(input)` and `key(input)`. `decisionTasks` lists the structured ones. `chatTools` holds the six Juno chat tool shapes.
- `cacheKeyOf(task, input)`: `{ task, key, inputHash }` for the assistant's `ai_cache`. The hash covers the task version and the canonical input (sorted keys, `undefined` dropped), so equal inputs hash the same and a prompt change is made visible by bumping `version`.
- `validateOutput(task, input, args)`: the schema check (pi-ai's validator) plus the task's `accept` rule. Both providers use it.
- `PiAiProvider.layer(config, models?)`: `config` is an `Effect<AiConfig>` read on every call, so a key or model added in preferences applies without a restart. `AiConfig` is `{ apiKey?, models?: { decision?, generation? } }`. `defaultModelPrefs` holds the default slugs.
- `FakeAiProvider.layer`, `makeFakeAiProvider()`: deterministic. Select it with `JUNO_AI=fake` in the engine (that wiring is the assistant's job).
- `Type`, `Static`: TypeBox, re-exported so the assistant can declare tool parameters without importing pi-ai.

Ids in outputs are plain strings. The `accept` rule of each task guarantees they point into the input, so the caller may brand them.

## What it decides

- **Tier and shape are separate.** `tier` picks the model and the default timeout (decisions 1.5 s, generation 20 s, chat 60 s). Shape is structured or text. `forYou` is structured on the generation tier: cards need judgment and run in the background.
- **Decisions are one forced tool call.** The task's output schema is the tool's parameters, pi-ai forces that tool (`tool_choice` by API: Anthropic `{ type: 'tool' }`, OpenAI-compatible `{ type: 'function' }`), the arguments are validated, then `accept` runs. An invalid answer or a provider error is retried once inside the task's timeout. Anything else is `NoDecision`.
- **The provider enforces the timeout.** The task table carries the number; the provider ties it to the request's `AbortSignal` so a slow call is cancelled, not just ignored.
- **Thinking is off for Anthropic models.** A decision has no time for it. OpenAI-compatible models keep their defaults; see Open questions.
- **Unknown slugs still work.** A slug missing from pi-ai's catalogue is sent as an OpenAI-compatible model; its cost is then unknown and `meta.costUsd` is absent.
- **Prompts are code.** `src/tasks/<task>.prompt.ts` next to each task, plain template strings. Shared rules in `src/tasks/shared.ts`: plain text, no markdown or emoji, never write for the user, quiet option when unsure.
- **The fake validates too.** Word rules in `src/fake/rules.ts`, canned chat turns in `src/fake/replies.ts`. Their output goes through `validateOutput`, so a broken rule is a `NoDecision` in a test, never a crash.
- **Chat is one turn.** `chat` streams the assistant's reply and its tool calls, validated against `tools`; the caller runs the tools, appends `tool` messages and calls again. The chat system prompt plus the facts block (`now`, the topic "this" means) come from the `chat` task.

## Defaults

`anthropic/claude-haiku-5.5` for decisions and `anthropic/claude-sonnet-5.5` for generation, checked against OpenRouter's public list on 2026-10-13 (both support tool calling; 0.10/0.50 and 2/10 USD per million tokens). Preferences override them.

## Eval

`pnpm ai:eval` runs every task on invented examples (`eval/examples.ts`) with the fake. `JUNO_AI=live pnpm ai:eval` uses OpenRouter with `OPENROUTER_API_KEY` from the environment or the repo's `.env`, and prints each output with latency, cost and attempts. Without a key it says so and exits 0. `pnpm ai:eval routeCheck` runs one task. `JUNO_AI_DECISION_MODEL` and `JUNO_AI_GENERATION_MODEL` try other slugs for a run.

## Tests

`pnpm --filter @juno/ai test`. Behaviour through the interface with the fake; the schema and `accept` rules; `PiAiProvider` against pi-ai's scripted faux provider (valid call, retry, two invalid answers, provider error, timeout, missing key, chat streaming); cache key stability. No test depends on prompt wording.

## Open questions

- OpenRouter also serves TypeSafe's System One decision models (`typesafe/jev-1.13`, and others) through pi-ai's `classify` API, which SPEC 15 mentions as a fit for decisions. Not evaluated; the forced tool call works on any chat model.
- OpenAI-compatible reasoning models keep their default reasoning effort; a decision model that thinks by default may miss 1.5 s. Set `reasoningEffort` once a non-Anthropic decision model is chosen.
- `parseCommand` returns the intent (`kind`, target id, text) and a confidence; building the domain `Command` with its label and hint from that intent is a domain helper that does not exist yet.
- Outputs return ids as plain strings; branding them at the boundary is left to the caller.

## Must not

- Import the store, the engine, Electron or `@juno/contract`. The only `@juno` dependency is `@juno/domain`, for types.
- Read the key from disk or the environment. Only `eval/run.ts` reads `OPENROUTER_API_KEY`, and only for the manual eval.
- Hard-code a model slug anywhere but `defaultModelPrefs`.
- Throw. A failure is a `NoDecision` or a `failed` event.
