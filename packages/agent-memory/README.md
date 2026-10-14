# @juno/agent-memory

Pure memory rules for Juno Agent. No I/O, Effect services or pi. Plan v3 sections 4–5 define the rules; `specs/agent-memory.qnt` models publication and races around them.

## What it holds

- `nodeKey`, `children`, `dueBefore`: aligned `(a, w)` intervals, corresponding to `(l, i)` with `w = 2**l` and `a = i*w`. Due order uses exact integer products, the pair's inclusive last source, and oldest-start ties.
- `merge`, `batch`, `renderView`: sibling merges using exact built child versions, 128,000/64,000-byte batching, and ordered view rendering. Masked lines keep their intervals. Rendering refuses a view beyond the run cutoff; there is no empty-view fallback.
- `context`, `deps`, `taintClosure`, `mask`: raw archive context, recorded source reachability, and exact masking. Context reads newest first, skips removed sources, counts rendered UTF-8 bytes plus framing, and stops at the first source that does not fit 16,384 bytes. It never reads pins or summaries. Dependencies follow child versions only; raw context IDs terminate the closure.
- `start`, `complete`, `compactionTask`: source copies, five total attempts, shortest-wins, the 512-byte target and ruler. Every retry renders the original bounded input without earlier answers. A leaf with only oversized answers copies its source; a parent cuts its shortest answer at a code point boundary, including `(cut)` within 16,384 bytes. `cut` is returned for the caller to log.
- `readyQueue`, `retryDelay`, `withinCutoff`: eight workers, fewer than eight earlier missing leaves, built parent inputs, retry deadlines, and the live run ceiling. The caller supplies pending rows and clean built nodes, rather than asking this package to discover work by walking the archive.
- `partition`, `upper`, `admit`, `requiredWindow`, `buildRequest`: half-open view/tail/active ranges, exact rendered byte accounting with 64 tokens per message, the optional 1.25 multiplier, and the 16,384-token reserve. The builder preserves pin text and tool IDs/metadata, pages large tool results, caps the tail with one range placeholder, and applies the ordered budget fallbacks. It returns `admitted` or `blocked`; no provider call happens here.
- `remember`, `editPin`, `deactivatePin`, `redactPins`, `snapshotCurrent`: exact UTF-8 spans from current-run owner messages, owner edits with source lineage, version comparisons, the pin budget and pin revisions. An edit refuses a stale version or removed source. Every successful change increments the revision.

Import from `@juno/agent-memory`; the public API is exported from `src/index.ts`. Inputs and results are readonly. `Key` uses half-open intervals, `Ref` adds an immutable version, and `Node` records its exact child references, raw context IDs and their cached source closure. `Completion` distinguishes another attempt from a ready node; `PinChange` distinguishes a committed candidate from a refusal.

## Caller responsibilities

Pass one consistent snapshot. Archive sources are ordered, dense chunks of at most 16,384 bytes. The context function accepts candidates in ascending ID order. Fetch the nearest 257 retained sources before the node (or all of them if fewer remain); 64-byte framing alone guarantees that this includes the first non-fitting source. It does not require loading the whole archive, and removed rows may be omitted from that query. The tail has one entry per selected archive chunk, in order. Each active provider entry declares its half-open archive span with `sourcePos` and `sourceEnd`; those spans cover the active suffix in order. This keeps a large chunked tool result in one provider entry with one call ID. Active tool-call/result pairs must be complete and preserve their provider metadata; metadata must include the serialized provider fields counted against the budget. System and tool declarations must be the exact serialized strings sent to the model.

Pass only clean built nodes to merging and queue selection. The caller persists nodes, pins, queues and heads, gives pins globally unique IDs, and commits publication under the input digest, generation, head revision and cutoff checks. Pin changes commit under the snapshot revision and source checks. Revalidate `gen` and `pinRev` at request admission. Emergency request merges return a new partition for the caller to persist under head CAS and rebuild before dispatch; they do not authorize silently changing the persisted head.

`buildRequest` returns the rendered messages and snapshot revisions for hashing. It does not create a trusted provider stamp, reserve spend, perform redaction transactions, purge storage or verify a provider tokenizer. Those belong to `agent` and its provider guard. Admission must count the final wire representation again if an adapter adds framing or fields.

The compatibility bound includes fixed compaction task space, raw context, both capped children and output reserve. Use that bound instead of the stale 64k minimum still present in plan v3 section 7.1. Section 5.3 and G4 require a larger window. The 280-byte span limit applies to `remember`; owner edits use the 4,096-byte active total.

## Must not

- Do I/O, read the clock, hold mutable shared state, or import Effect or pi.
- Import another workspace package. `allowedDeps` stays empty.
- Treat summary text as proof of its provenance, or infer dependencies from model output.

## Testing

From the root, run `pnpm --filter @juno/agent-memory test`. Its script takes the machine-wide heavy-job lock, including when called through `pnpm test`.

The tests use the public API: six safety properties (exact closure, local taint, cutoff, node size, parent input, and request partition/budget), due order against independent rollback push at every t from 0 through 20,000, and three compaction task examples. fast-check and Vitest are development dependencies; `juno.testDeps` applies only to workspace package edges.
