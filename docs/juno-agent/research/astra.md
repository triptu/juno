# Juno Agent research: memory, durability, and sync

Observed: researched on 2026-10-14. This report reads the owner's [brief](../BRIEF.md), [project rules](../../../CLAUDE.md), [AI package](../../../packages/ai/README.md), [architecture](../../architecture.md), [assistant spec](../../design/handoff/SPEC.md#13-juno-the-assistant), and [Quint workflow](../../../specs/README.md). No tests, builds, or model checks were run. The Quint below is a candidate design, not a verified implementation.

Labels apply to the paragraph, list item, or code block they introduce. **Observed** means directly supported by the linked source. **Inferred** means analysis or a proposed design. **Unknown** means the reviewed evidence does not establish the claim.

## Findings that change the plan

- Inferred: adopt optmem's immutable log, immutable summary tree, persistent view, and zoom operation. Add explicit pins, source provenance, atomic publication, and a request budget. The gist alone cannot guarantee semantic recall or a hard context bound.
- Observed: pi's latest published release is **1.2.0**, released October 12. Both `@earendil-works/pi-durable` and `@earendil-works/pi-mcp` are published at that version. Juno currently pins `pi-ai` 1.1.0. The brief's durability and MCP premise is supported, but those capabilities belong to separate packages. [Release][release], [npm metadata][npm], [local manifest](../../../packages/ai/package.json).
- Inferred: choose one authoritative conversation executor and ordered commit stream, with SQLite replicas and offline input queues on devices. An assistant that acts on external systems needs stronger coordination than merging chat text.
- Observed: pi's `beforeRequest` hook can replace context, but hook exceptions are reported and execution continues. [Durable specification][durable-spec].
- Inferred: throwing from that hook cannot enforce a hard context-budget barrier. Unknown: whether the available extension points can implement optmem safely without changing pi needs an integration spike.

## 1. What optmem actually specifies

Observed: the linked gist currently contains `optchat.md`, titled "UniiChat: one chat that never ends." I read revision `3c190e06f34aba0c69f49042c526093269604935`, committed October 8. Its metadata was updated October 13. It is a design recipe, with claims about simulations, rather than an attached complete implementation or proof. [Pinned gist][optmem].

### Storage and operations

Observed: the durable data has three parts. Daily `main/*.jsonl` files contain `{i, kind, text, size, date}`. Daily `tree/*.jsonl` files contain `{l, i, text, size}`. `view.json` contains ordered `[l,i]` references. Message IDs are permanent. Kinds distinguish user messages, assistant replies, tool calls, results, subagent reports, and imported notes. One process owns the chat under a lock. Records are appended and flushed. Thoughts are excluded. Tool outputs are clipped to 30,000 characters, divided between head and tail; other oversized text is split across consecutive messages. [Optmem §1][optmem].

Observed: a node at level `l` and index `i` covers the aligned interval

```text
[i * 2^l, (i + 1) * 2^l)
```

Observed: level zero summarizes one message. A parent summarizes exactly its children `(l-1,2i)` and `(l-1,2i+1)`. The target is 512 UTF-8 bytes per node. Inputs that fit are retained directly; two short children may be joined directly. A published node is never rebuilt. The display name is `start+count`, so `(3,5)` is `40+8`. [Optmem §2][optmem].

Observed: the view is a chronological partition of the history into tree nodes. Newlines in node text become spaces when rendered. Dates are fetched separately. Recent intervals are smaller, older intervals larger. The normal view carries node text, including verbatim text when a short source already fits, rather than arbitrarily large raw messages. [Optmem §§2–3][optmem].

Observed: view reduction considers adjacent **siblings**, not merely adjacent equal-sized nodes. The parent must already exist. With `T` denoting the gist's message count, left-child start `a`, and child width `w`, the stated priority is

```text
last = a + 2*w - 1
due = (T - last) / w
```

Observed: merge the highest-priority eligible pair, break ties toward the oldest, and repeat. On exceeding 128,000 bytes, reduce toward 64,000 bytes. If ready parents cannot reach the target, continue the batch as later messages arrive. Save and reload the exact view; rebuilding it can change its layout and destroy prefix-cache reuse. [Optmem §3][optmem].

Inferred: compare priorities with integer cross multiplication. For pairs `p` and `q`, compare `(T-last(p))*w(q)` with `(T-last(q))*w(p)`. Preserve the gist's inclusive last-message convention. Its regression at `T=10`, view `0+4, 4+4, 8+1, 9+1`, must select `8+1` and `9+1`. Replacing the numerator with age from the first message, or silently changing the count convention, changes ordering.

Observed: compaction is the construction of one immutable node, separate from merging the view. At most eight compaction calls run concurrently. A leaf can start when fewer than eight earlier leaves remain unbuilt; a parent starts when both children exist. Work is queued rather than repeatedly found by scanning the tree. Failed calls retry at the next message. [Optmem §4][optmem].

Observed: compaction uses its own coarser view, roughly 16,000–32,000 bytes. It reduces that view when its threshold is exceeded or the chat view merges. That context ends before a leaf's input, or at the final message of a parent merge, and stops at the first unbuilt line. It helps resolve references but must not introduce unrelated facts. Compactions use the same system prompt and tool declarations as turns, but must call no tools. Oversized outputs get up to five shortening attempts; the shortest is kept, even if slightly over 512 bytes. This is a soft node limit. [Optmem §4][optmem].

Observed: each idle user input starts a fresh model conversation after preceding messages have summaries. The previous view is rendered before logging that new message, which is supplied whole after the view. Inputs arriving during work are delivered between tool calls. The shared system prompt and tools remain stable; turn-specific state follows the view. [Optmem §§5–6][optmem].

### Retrieval and the limits of "nothing is lost"

Observed: `zoom(start,count)` opens a node into two children; `zoom(start,1)` returns the source message, with pagination for long messages. `count` must be a power of two and `start` must be aligned to it. `date(id)` returns the source timestamp. A named subagent can expose its separate log. Navigation is model-directed zoom; the prompt disallows general memory search. It tells the model to find the latest mention and zoom to the original before acting. [Optmem §§5–6][optmem].

Inferred: three distinct guarantees need separate names:

1. **Storage preservation:** retained source bytes remain available. This excludes tool-output bytes discarded before logging.
2. **Structural reachability:** a node's descendants lead to every message in its interval.
3. **Semantic discoverability:** the model recognizes which interval contains a needed fact.

Inferred: the tree supports the first two with appropriate persistence. It does not prove the third. If every ancestor omits an old fact, the model has no reliable clue to zoom there. A bounded summary cannot encode all distinctions among arbitrarily many independent facts. "Latest mention" is also not equivalent to "true": later quotations, hypothetical statements, and untrusted tool content can contradict earlier user instructions.

Observed: the gist defines no pin table, explicit correction relation, transaction spanning log/tree/view, or multi-device merge protocol. Its prompt asks summaries to preserve corrections; that is an instruction to a model, not an invariant. [Optmem][optmem].

Unknown: the gist leaves recovery details unresolved, including partial JSONL writes, durable atomic replacement of `view.json`, and whether "flush" includes filesystem synchronization. Its prompt permits unsummarized placeholders, while its turn procedure waits for prior summaries. A Juno spec must choose one dispatch rule explicitly. [Optmem §§1, 5–6][optmem].

Inferred: retain full tool results as separately stored attachments when preservation matters; expose bounded pages to the model. Add exact, user-controlled pins with source IDs and explicit supersession. Add a fallback search over source text if evaluation demonstrates omitted-fact failures. This last change deliberately departs from the gist's zoom-only policy.

### Bounds that can and cannot hold

Inferred: for `N` messages, the fully constructed tree has `N + floor(N/2) + floor(N/4) + ... < 2N` nodes. Storage grows linearly before accounting for source-message sizes. A known leaf can be reached in tree-height many zooms; finding the right leaf without useful summaries may require visiting a linear number of nodes.

Inferred: a hard 128,000-byte bound is not an invariant of the recipe. Appending can cross the threshold, summaries can exceed 512 bytes, and required parents may not exist. A whole user input or a zoom result can also overflow the provider window independently of the view. Bytes are not tokens.

Inferred: there is a second, theoretical limit. A partition of `[0,N)` into aligned, fully populated binary intervals needs at least `popcount(N)` nodes. At `N=2^k-1`, that is `k` nodes, even after every possible merge. Thus an indefinitely growing chat cannot have both an exact whole-history dyadic partition and a fixed serialized byte bound forever. IDs also grow. For product-scale histories this may be remote, but a formal claim of an infinite constant-size view is false. A paged forest index or a partial-root representation would change the model and avoid this particular obstruction.

Inferred: promise bounded **dispatched requests**, durable storage, and a practical retention horizon. Admit a request only after checking the full provider-specific input, output reserve, tool schemas, active work, pins, and retrieval pages. Under overload, pause or use a defined bounded fallback; do not drop mandatory facts silently. Arbitrarily many mandatory pins and a fixed prompt bound are incompatible, so pin admission needs a budget or an explicit distinction between always-in-context pins and durable bookmarks.

## 2. Candidate formal verification

Inferred: separate a memory model, a request/resumption model, and a sync/execution model. Model the LLM as nondeterministic output, including omissions, hallucinations, oversized text, and failures. Structural correctness must not depend on assuming that summarization preserves meaning.

### Memory state, actions, and invariants

Inferred: the following Quint sketch models eight source records, aligned intervals, asynchronous node completion, a persisted view, exact pins, and zoom. A set represents the view; its renderer must sort by `a`. `covered` separates the published prefix from the unsummarized durable tail. This is a proposed Juno adaptation, not a literal transcription of the gist. Constants supply positive serialized byte sizes and conservative token costs, including node headers. Assume `0 <= low < high`, `window > 0`, and nonnegative token costs. The sketch has not been typechecked.

```quint
module agentMemory {
	const source: int -> int // Opaque immutable source values, keyed by ID.
	const bytes: { a: int, w: int } -> int
	const tokens: { a: int, w: int } -> int
	const pinTokens: int -> int
	const low: int
	const high: int
	const window: int
	const fixedTokens: int // System, schemas, active input, output reserve.

	type Node = { a: int, w: int }
	pure val ids = 0.to(7)
	pure val nodes: Set[Node] = ids.fold(Set(), (acc, a) =>
		acc.union(Set(1, 2, 4, 8).filter(w =>
			a % w == 0 and a + w <= 8).map(w => { a: a, w: w })))
	pure def span(x: Node): Set[int] = x.a.to(x.a + x.w - 1)
	pure def left(x: Node): Node = { a: x.a, w: x.w / 2 }
	pure def right(x: Node): Node = { a: x.a + x.w / 2, w: x.w / 2 }

	var s: {
		n: int, covered: int, log: int -> int,
		built: Set[Node], view: Set[Node], shrinking: bool,
		pins: Set[int], pinValue: int -> int,
		opened: Set[Node], requested: Set[int], returned: Set[int],
		sentTokens: int
	}

	val logged = ids.filter(i => i < s.n)
	val viewBytes = s.view.fold(0, (total, x) => total + bytes.get(x))
	val requestTokens = fixedTokens
		+ s.view.fold(0, (total, x) => total + tokens.get(x))
		+ s.pins.fold(0, (total, i) => total + pinTokens.get(i))
	val candidates = nodes.filter(p => p.w > 1
		and s.built.contains(p)
		and s.view.contains(left(p)) and s.view.contains(right(p)))
	def age(p: Node): int = s.n - (p.a + p.w - 1)
	def before(p: Node, q: Node): bool =
		age(p) * q.w > age(q) * p.w or
		(age(p) * q.w == age(q) * p.w and p.a <= q.a)
	// Parent widths are twice child widths; the common factor cancels.

	action init = s' = {
		n: 0, covered: 0, log: ids.mapBy(_ => -1),
		built: Set(), view: Set(), shrinking: false,
		pins: Set(), pinValue: ids.mapBy(_ => -1),
		opened: Set(), requested: Set(), returned: Set(), sentTokens: 0
	}
	action append = all {
		s.n < 8,
		s' = { ...s, log: s.log.set(s.n, source.get(s.n)), n: s.n + 1 }
	}
	action build(x: Node) = all {
		nodes.contains(x), not(s.built.contains(x)), x.a + x.w <= s.n,
		if (x.w == 1) true else
			s.built.contains(left(x)) and s.built.contains(right(x)),
		s' = { ...s, built: s.built.union(Set(x)) }
	}
	action publishLeaf = {
		val x = { a: s.covered, w: 1 }
		all {
			s.covered < s.n, s.built.contains(x),
			s' = { ...s, covered: s.covered + 1, view: s.view.union(Set(x)),
				shrinking: s.shrinking or viewBytes + bytes.get(x) > high }
		}
	}
	action merge(p: Node) = all {
		s.shrinking, viewBytes > low,
		candidates.contains(p), candidates.forall(q => before(p, q)),
		s' = { ...s, view: s.view.exclude(Set(left(p), right(p))).union(Set(p)) }
	}
	action finishBatch = all {
		s.shrinking, viewBytes <= low,
		s' = { ...s, shrinking: false }
	}
	action pin(i: int) = all {
		logged.contains(i),
		s' = { ...s, pins: s.pins.union(Set(i)), pinValue: s.pinValue.set(i, s.log.get(i)) }
	}
	action zoom(x: Node) = all {
		s.built.contains(x),
		if (x.w == 1)
			s' = { ...s, requested: Set(x.a), returned: Set(x.a), opened: Set() }
		else
			s' = { ...s, requested: span(x), returned: Set(), opened: Set(left(x), right(x)) }
	}
	action dispatch = all {
		s.covered == s.n, requestTokens <= window,
		s' = { ...s, sentTokens: requestTokens }
	}
	action crash = s' = s // Only committed state is represented here.
	action step = {
		nondet x = nodes.oneOf()
		nondet i = ids.oneOf()
		any { append, build(x), publishLeaf, merge(x), finishBatch, pin(i), zoom(x), dispatch, crash }
	}

	val noSourceLoss = logged.forall(i => s.log.get(i) == source.get(i))
	val pinnedExact = s.pins.subseteq(logged)
		and s.pins.forall(i => s.pinValue.get(i) == source.get(i))
	val treeClosed = s.built.forall(x => x.w == 1 or
		(s.built.contains(left(x)) and s.built.contains(right(x))))
	val completePrefix = s.view.map(x => span(x)).flatten()
		== ids.filter(i => i < s.covered)
	val disjoint = s.view.forall(x => s.view.forall(y =>
		x == y or span(x).intersect(span(y)) == Set()))
	val publishedOnly = s.view.subseteq(s.built)
	val retrievalSound = s.returned.subseteq(s.requested)
		and s.returned.subseteq(logged)
		and s.opened.subseteq(s.built)
		and (if (s.opened == Set()) s.returned else
			s.opened.map(x => span(x)).flatten()) == s.requested
	val boundedDispatch = s.sentTokens <= window
	val invariants = noSourceLoss and pinnedExact and treeClosed
		and completePrefix and disjoint and publishedOnly
		and retrievalSound and boundedDispatch
}
```

Inferred: the `build` action abstracts the **commit** of a successful candidate. A refinement must add pending jobs, failures, and candidate output records. Store the immutable node text, its measured size, input digest, model and prompt versions, and source interval in that commit. A unique node key makes retries publish once; it does not make repeated LLM outputs equal. First committed output wins. Concurrent jobs may finish out of order without changing source IDs or existing nodes.

Inferred: the code's token costs are an abstraction boundary, not evidence that byte sizes predict token counts. An implementation check must render the actual request, including retrieved pages and message framing, and verify its provider token bound. Pins in this sketch designate whole opaque records. Real pins need immutable exact spans or structured values with source IDs, an explicit replacement action, and a budget policy. Unpinning and deletion are intentionally outside this small model.

Inferred: add these relational properties when expanding the model. They concern consecutive states, so implement them with ghost copies or transition assertions rather than treating them as ordinary single-state predicates:

- `builtBefore ⊆ builtAfter` and unchanged text for every previously built node.
- `coveredAfter >= coveredBefore`.
- On a view merge, the union of covered message IDs is unchanged and node count decreases by one.
- Within the old covered prefix, every old view interval is contained in exactly one new interval. This is **monotonic coarsening**, not monotonic retention of natural-language facts.
- Committed view revisions increase. Restart loads exactly the last committed view and its watermark; it never chooses a new partition from the log.
- A pinned value remains available until an explicit authorized replacement or removal. A dispatch includes every admitted always-in-context pin as exact content.

Inferred: structural retrieval soundness means correct source IDs and exact source bytes, not relevance or truth. Add `SummaryClaims(node) ⊆ SupportedClaims(sources)` only in a separate abstraction with an explicit semantic oracle. Allow a bad summary in that model and show it violates the claim. Assuming an infallible oracle would make a semantic "proof" circular. Factual support also differs from authority to give instructions.

### Checks, counterexamples, and proof obligations

Inferred: start with four messages for exhaustive bounded checks, eight or sixteen for simulations, and explicit byte costs around both thresholds. Use separately modeled crashes before and after each SQLite commit, delayed parents, oversized outputs, pin updates, and stale view jobs. Add these directed negative cases:

- Merge adjacent non-siblings: violate alignment or coverage.
- Install a view before its parent commits: violate `publishedOnly` after restart.
- Crash after log commit but before view commit: recovery must retain the tail and schedule missing work without changing the committed prefix.
- Rebuild a view on restart: preserve coverage but violate exact persisted-view identity.
- Wrong priority origin: fail the `T=10` ordering witness.
- Complete an old compaction after a newer one: reject stale publication or rebase through an explicit action; never overwrite the newer view.
- Insert an unbounded user input, tool result, or pin: dispatch must remain disabled until the budget policy resolves it.
- Remove an important fact from a summary: source preservation still passes while discoverability fails. Keep this distinction visible in the report.

Inferred: state safety properties separately from conditional progress. "Eventually every accepted message is summarized" requires fair scheduling, eventual successful model calls, and no permanent resource exhaustion. The gist retries failures only on another message, so a final failed compaction can remain unbuilt forever in a quiet chat. Juno needs persisted retry deadlines independent of new user input. Eventual reduction below the low watermark additionally requires a feasible partition and sufficiently small available summaries.

Observed: the repository already distinguishes sampled simulation, shallow bounded checking, and unproved temporal formulas. Follow that standard; a finite passing run is not an unbounded proof. [Local Quint guide](../../../specs/README.md), [Quint checker guide][quint].

Inferred: later implementation work should add model checks through `pnpm specs:check`, preserve deliberately broken variants that produce counterexamples, and replay selected traces against a fake model and fake MCP server. Induction over append, build, and sibling merge can prove interval coverage and immutability for arbitrary `N`; finite model checking finds schedules but does not replace that argument. Semantic recall requires separate evaluations with old corrections, rare names, contradictory quotations, and repeated summarization.

## 3. One infinite chat, finite requests

Observed: Anthropic describes compaction, persistent notes, and focused retrieval as approaches to long-running tasks, while warning that aggressive summaries omit details. "Lost in the Middle" demonstrates position-sensitive retrieval on the models studied; it does not establish a numerical accuracy bound for Juno's current models. [Context engineering][context], [paper][middle].

Inferred: use a hybrid request consisting of stable policy, admitted exact pins, optmem's view, structured active-work state, and the current turn's verbatim tool-call/result chain. Sliding windows alone forget commitments; recursively rewritten flat summaries accumulate omissions; retrieval alone lacks chronological continuity. Optmem supplies that continuity, while structured state protects ongoing work that cannot safely become prose.

Inferred: persist separate records for user inputs, tool intents, approvals bound to the exact arguments, execution attempts, receipts, schedules, and delegated-task IDs. A summary is a projection for the model. It must never decide whether a tool already ran, whether an approval remains valid, or whether a job is complete. Current Juno behavior requires a click before sending a proposed message. Preserve that rule in the execution state machine. [Assistant spec](../../design/handoff/SPEC.md#13-juno-the-assistant).

Inferred: compaction should capture a committed cutoff and source digest, build outside the transaction, then publish its node and view change through an atomic compare-and-swap. Input arriving later stays in the tail. Resume must recover pending intents before generating more actions. A crash after a remote effect but before saving its receipt is an **unknown outcome**, requiring idempotent retry or reconciliation. Neither summarization nor database replay solves that uncertainty.

Inferred: a single user-visible conversation can contain many model requests and resumable task executions. During a long turn, periodically rebuild bounded context at safe tool boundaries. Keep unresolved tool calls paired with results and retain provider-required IDs or signatures. Fresh top-level sessions alone do not prevent one long tool loop from filling its window.

Observed: optmem recommends stable prefixes and batched view changes for cache reuse. Anthropic documents prefix caching, cache lifetimes, and cache markers. Cache state is provider-specific and ephemeral. [Optmem §3][optmem], [Anthropic cache documentation][cache].

Inferred: treat cache hits as an optimization. Resume must work after total cache eviction, a model change, or an account change. The gist's cache simulations are not measurements of Juno, OpenRouter, Codex, or Claude Code subscription behavior. Do not turn its reported percentages into latency or cost promises.

Unknown: the acceptable delay while waiting for preceding summaries, the recall target for old facts, and the offline-execution requirement are not settled in the brief. Measure these before copying the gist's byte thresholds as product defaults.

## 4. What pi 1.2.0 provides now

Observed: npm's `latest` tag resolves to 1.2.0 for `pi-ai`, `pi-agent-core`, `pi-durable`, `pi-mcp`, and `pi-coding-agent`, all published October 12. The former `badlogic/pi-mono` repository redirects to `earendil-works/pi`. Findings below use release-tagged documentation, not just `main`. [Release][release], [npm durable][npm], [npm MCP][npm-mcp].

### Durable runtime

Observed: `pi-durable` is explicitly experimental, with APIs allowed to change between releases. Its `Harness` owns a storage, immutable transcript entries, atomic commits, typed documents, durable task checkpoints, and per-conversation inboxes. `submit({requestId})` deduplicates a retried input. Reopening and calling `resume()` restarts unfinished tasks. Changes are stored before publication. Provider session IDs persist across reopen and compaction. [Durable README][durable].

Observed: built-in tools commit intent before execution. A tool interrupted by a crash reruns only with `replay: "safe"`; otherwise it returns an interrupted outcome with committed output. Nested calls reuse durable keys, but external effects still require idempotency. This is not a universal exactly-once guarantee. [Durable README][durable], [durable specification][durable-spec].

Observed: SQLite, JSONL, in-memory, and Cloudflare Durable Object SQLite adapters exist. The Node SQLite adapter uses WAL with `synchronous=NORMAL`: process-crash recovery is promised, but the latest commits may be lost on power or host failure. JSONL can fsync commit markers but retains history in memory. One process must own storage; the package supplies no cross-process lock. [Storage documentation][durable], [Node adapter][sqlite-adapter].

Observed: built-in compaction retains old entries, adds a summary entry and a retained-history boundary, supports background preparation and turn-boundary publication, and rejects older cuts as stale. Defaults documented for reserves and retained recent context are token-based. `beforeCompact` can replace the summary; generation's `beforeRequest` can replace request messages. The built-in algorithm is not optmem's binary tree. [Durable compaction and hooks][durable].

Inferred: wrap `pi-durable` behind a portable Juno runtime interface. Keep Slack, Electron, notifications, and credential storage in adapters. Keep the existing `@juno/ai` provider independent of storage, as its README requires. Pin a coherent pi release and implement memory state in the same atomic storage boundary as its durable tasks, or define a recoverable projection protocol if two stores are unavoidable.

Unknown: Chord's replicated views do not, from the reviewed documentation, establish an offline multi-writer SQLite sync protocol for Juno. Nor is there evidence that the built-in durable runtime automatically coordinates multiple device executors. Treat those as application work.

### MCP

Observed: `pi-mcp` is a standalone client with stdio and Streamable HTTP transports, request cancellation, progress, paginated tool discovery, structured tool results, HTTP stream resumption, and OAuth helpers. It supports MCP `2025-11-25` with older negotiated versions. Its documented exclusions include legacy HTTP+SSE, sampling, protocol tasks, server implementation, and batched JSON-RPC. [MCP package][mcp].

Observed: OAuth helpers support discovery, PKCE, registration, refresh, and scope escalation. The embedding app supplies durable credential storage and opens the browser. Pi's coding-agent CLI separately provides `mcp.json`, connection management, sign-in, tool exposure, and resources. An SDK consumer does not receive that entire CLI product merely by importing `pi-mcp`. [MCP package][mcp], [CLI MCP documentation][mcp-cli].

Inferred: bridge MCP calls into `pi-durable` tools so intents, approvals, results, and interrupted outcomes share its task model. Classify replay policy per operation. A server's read-only annotation is evidence, not proof of harmlessness. Durable T3 task IDs and reconciliation should protect delegated work against duplicate launch after a lost response. MCP stream resumption does not itself establish exactly-once tool execution.

Unknown: compatibility with the particular T3, Littlebird, and Notion deployments still needs checks for endpoints, transport, auth, pagination, and idempotency. This research did not connect to those services or use personal credentials.

## 5. SQLite sync and one authoritative executor

Observed: SQLite serializes writes within a database, and WAL readers see snapshots. WAL is not a cross-device replication protocol and requires same-host shared memory. The session extension produces and applies changesets with conflict handling; it does not choose Juno's application consistency policy. [Isolation][isolation], [WAL][wal], [session extension][session].

Inferred: use **linearizable admission and execution decisions at one authority**, with an **ordered, eventually replicated commit log** on devices. Devices provide local read-your-writes for explicitly pending inputs. Confirmed state is a monotonic prefix of the authority's history. This sacrifices new authoritative execution during an authority outage while retaining offline reading and queued input.

Inferred: the authority can be an always-on service or one designated machine. A standalone instance can host the same role locally. Switching that role requires a controlled transfer of committed state and exclusive ownership; arbitrary partitioned devices must not elect themselves by wall-clock timeout alone.

Inferred: acquire an OS-level ownership lock before opening pi's storage. For acknowledged writes that must survive power loss, use a SQLite adapter configured with `synchronous=FULL`, subject to SQLite's filesystem assumptions, or acknowledge only after a durable replicated commit. Pi's default `NORMAL` adapter cannot support that stronger durability claim. Define device-loss recovery separately; a local fsync does not replace replication or backup. [Pi adapter][sqlite-adapter], [SQLite WAL durability][wal].

Inferred: each device submits a globally unique operation ID and its last observed commit position. The authority deduplicates operations, preserves causal dependencies, assigns the next sequence number, and atomically commits transcript entries, memory changes, task state, and replication records. Each replica applies a complete batch and advances its cursor in one SQLite transaction. Out-of-order batches wait for gaps; duplicate batches are harmless. Local drafts remain outside the canonical sequence until admitted.

Inferred: sequence IDs, not device wall clocks, order the optmem tree. Once assigned, IDs never move. A newly synced offline input is appended after its dependencies, with its original creation time as metadata. Renumbering old messages would invalidate intervals, source references, summaries, and cached prefixes. Summary workers can run elsewhere, but the authority validates source digests and accepts at most one result per immutable node key.

Inferred: use increasing fencing epochs when changing executors. Every authorized dispatch goes through a service that checks the current epoch. A lease checked only in the executor cannot stop an isolated old process from calling Slack or another MCP server. Requests already sent before transfer remain in flight; fencing cannot unsend them. Keep their intents unresolved and reconcile them, using destination-supported idempotency keys where available. Never describe all external effects as exactly once.

### Candidate sync state and properties

Inferred: this smaller Quint fragment describes ordered replication, not leader election. `commit` represents one complete atomic batch by the sole authority. `pull` can be delayed indefinitely to model partitions. A full model adds local pending inputs, operation payloads, causal parents, execution epochs, and distinct send/accept/acknowledge transitions.

```quint
module agentReplication {
	const devices: Set[int]
	const operationIds: Set[int]
	var s: {
		journal: List[int], accepted: Set[int],
		cursor: int -> int, replica: int -> List[int]
	}
	action init = s' = {
		journal: List(), accepted: Set(),
		cursor: devices.mapBy(_ => 0), replica: devices.mapBy(_ => List())
	}
	action commit(op: int) = all {
		operationIds.contains(op), not(s.accepted.contains(op)),
		s' = { ...s, journal: s.journal.append(op), accepted: s.accepted.union(Set(op)) }
	}
	action retryAccepted(op: int) = all { s.accepted.contains(op), s' = s }
	action pull(d: int) = {
		val k = s.cursor.get(d)
		all {
			devices.contains(d), k < s.journal.length(),
			s' = { ...s,
				replica: s.replica.set(d, s.replica.get(d).append(s.journal.nth(k))),
				cursor: s.cursor.set(d, k + 1) }
		}
	}
	val prefixAgreement = devices.forall(d =>
		s.replica.get(d) == s.journal.slice(0, s.cursor.get(d)))
	val oneAdmission = s.journal.length() == s.accepted.size()
	val caughtUp = devices.forall(d => s.cursor.get(d) == s.journal.length())
}
```

Inferred: `prefixAgreement` permits stale replicas but forbids forks and partially applied commits. A separate execution model should check that dispatch references a committed intent and the current approval revision, stale epochs cannot authorize new dispatches, one scheduled occurrence creates one intent, and lost responses never imply a failed remote effect. Model a gateway and destination separately so the fencing property is not assumed inside the executor.

Inferred: counterexamples should include two offline submissions, duplicate delivery, a crash during replica application, a stale snapshot arriving after newer deltas, restored device state reusing an operation ID, an expired executor continuing, and a remote success followed by a lost receipt. Snapshot installation must atomically set state and cursor; reject an older snapshot unless deliberately rebuilding a replica. Tombstones and compaction of replication history require a device-retirement or snapshot catch-up policy.

Inferred: eventual convergence requires connectivity to recover, pending operations and batches to be delivered fairly, and the authority to remain available. Under permanent quiet, replicas then reach the same commit position. Safety should hold even through permanent partitions. Do not model `seal` by assigning replicas equal to the authority; require actual delivery actions, as Juno's existing specs do.

Inferred: choose per-device conflict resolution only for genuinely independent state such as drafts or display preferences. Last-writer-wins on assistant replies, approvals, task completion, or memory-view pointers can silently discard required work. A general multi-writer CRDT would not prevent duplicate external actions or reconcile contradictory approvals by itself.

## Sources

Observed: external sources were retrieved on 2026-10-14. Release-tagged links below preserve the reviewed pi API. npm tags remain mutable.

- [Optmem / UniiChat, pinned revision][optmem]
- [Pi 1.2.0 release][release]; [npm durable metadata][npm]; [npm MCP metadata][npm-mcp]
- [pi-durable README][durable]; [normative specification][durable-spec]; [Node SQLite adapter][sqlite-adapter]
- [pi-mcp README][mcp]; [coding-agent MCP documentation][mcp-cli]
- [Anthropic context engineering][context]; [prompt caching][cache]; [Lost in the Middle][middle]
- [SQLite isolation][isolation]; [WAL][wal]; [session extension][session]
- [Quint language reference][quint-lang]; [model checker guide][quint]

[optmem]: https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449/3c190e06f34aba0c69f49042c526093269604935
[release]: https://github.com/earendil-works/pi/releases/tag/v1.2.0
[npm]: https://registry.npmjs.org/@earendil-works/pi-durable/latest
[npm-mcp]: https://registry.npmjs.org/@earendil-works/pi-mcp/latest
[durable]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/durable/README.md
[durable-spec]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/durable/docs/spec.md
[sqlite-adapter]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/durable/src/storage/sqlite/node.ts
[mcp]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/mcp/README.md
[mcp-cli]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/mcp.md
[context]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
[middle]: https://arxiv.org/abs/2307.03172
[cache]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[isolation]: https://sqlite.org/isolation.html
[wal]: https://sqlite.org/wal.html
[session]: https://sqlite.org/sessionintro.html
[quint-lang]: https://quint.sh/docs/lang
[quint]: https://quint.sh/docs/model-checkers
