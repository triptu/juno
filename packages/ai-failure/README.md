# @juno/ai-failure

Sorts a model provider's error into a kind, from the text pi-ai gives: the HTTP status the SDK puts first ("400 {…}", "Provider (503): …"), then the code and words of OpenRouter's or the model's error body. A leaf with no dependencies, so the engine's provider (`@juno/ai`) and the agent's guard (`@juno/agent`) sort a refusal the same way without either reaching the other's dependencies.

## Public API

- `AiFailureKind`: `policy`, `bad-request`, `context-length`, `model-not-found`, `auth`, `credits`, `rate-limited`, `unavailable`, `server`, `timeout`, `network`, `unknown`.
- `classifyFailure(text)`: the kind. A 403 that names a policy or moderation is `policy`, not `auth`; a refused connection (`ECONNREFUSED`) is `network`.
- `isRetryable(kind)`: whether the same request can pass later. Not for `policy`, `bad-request`, `context-length`, `model-not-found`, `auth` and `credits`.
- `fallbackHelps(kind)`: whether another maker's model is worth one call: `policy`, `model-not-found`, `unavailable`.
- `refusedBeforeOutput(text)`: a 4xx status from the response's headers (or a rate limit), so the request was not billed. An error inside a 200 stream is not this.
- `failureStatus(text)`, `modelMaker(slug)` ("anthropic" for "anthropic/claude-sonnet-5.5").

## Tests

`bun run --cwd packages/ai-failure test`: OpenRouter-shaped error bodies (none real) to kinds, and what each kind means for the next try.

## Must not

Import anything. It stays a leaf so any package may depend on it.
