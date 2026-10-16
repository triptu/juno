# T3 Code adapter (WP18)

`createT3Adapter(manager)` uses WP17's manager only. `withMcp` registers its
fixed tools, executors and resumable job driver. The router adds three narrow
hooks: job drivers, access to jobs when registering tools, and an external
job's Stop. `where` carries the project and branch, and `because` shows the approved brief.
Task Open uses the fixed `t3-thread://v1/<threadId>` link. A completed task
uses `thread.linkedPullRequest` for Open PR; message text never creates a PR link.

`t3_start({ project, baseBranch, title, brief, planFirst, replaces? })` always
stores a Proposed task card. Project is the discovered project id. The digest
contains the exact launch arguments, connection epoch, schema hash and
project destination. Start launches with full access and a new worktree based
on the local base ref. A schema that cannot express those arguments fails
before a card or launch. Native plan mode is preferred; its absence adds
"Write a plan, then wait for approval before changing files" to the visible,
approved brief. Replacing an open T3 proposal uses WP15's expiry path.

The Start click records one attempt, invokes `t3_thread_launch` once, records
the returned thread in the job, and mints its grant. A session T3 Code
confirmed always gets its job and Task card; the grant needs the card's memory
generation and the connection's account to still hold. Lost responses stay
unknown. A launch carries `[juno:<action id>]`; reconciliation reads candidate
threads and requires the same project and exact original message. A negative
search never permits another launch. A reconciled receipt does not restore a
revoked grant. Generic `call_tool` cannot launch, even if launch was moved to
Read in Connections. Through `call_tool`, a T3 tool skips the card only when it
is on the T3 preset's read list and still Read: T3 Code can also start, fork
and steer sessions under other names, so moving those to Read does not remove
the click.

`t3_send` and `t3_stop` use an existing job, never a model-supplied grant. A
clean owner run with the job's live grant records a Change intent and an
attempt without a click. The settled Change card is the audit record. A
send without that authority leaves the Change card open; a stop without it
points to the Task card. Task Stop is already an owner click: it approves
one stored interrupt through the dispatcher, under the click's op, with no
second click. While Juno is paused or off, Stop approves nothing and the job
keeps running: Pause stops every job, and an interrupt queued then would reach
T3 Code on Resume with no click. Failed stops remain visible on their Change
card and do not claim the session stopped. A later Stop click is a new click:
it gets a new interrupt card, since an interrupt repeated on a session is
harmless; an interrupt still on its way is not sent again. A Stop that cannot
be built leaves the job running and never fails the click.
Closing Juno only stops observation; it does not interrupt the external session.

A removal that reaches the run that started a session makes Juno stop
watching it: the job settles unknown with "Juno stopped watching after a
removal", so no report carries the removed words to the model and the card
does not claim the session stopped. The interrupt goes through the same
Change card, proposed with a line saying why, and is sent only when the owner
clicks Apply. The removal click is not taken as approval of an interrupt the
owner has not seen.

The watcher resumes from the recorded thread, never from the launch brief.
It reads durable thread state, updates the job's `where` from a targeted
worktree status when supported, otherwise from the matching thread's own
worktree binding (`threadId` and `branch` in `t3_thread_read`). With neither,
it says "branch pending" rather than showing the base branch as the session
branch. Connection loss is `lostSight`; a changed connection epoch stops
observation as unknown. This deliberately does not follow a thread into a
new account after sign-in.

Single-choice pending user questions with two to four options become Question
cards. Their exact selected value or free text reaches
`t3_pending_request_respond` once. Unknown, multi-question and multi-select
shapes stay in T3, and the Task card says "T3 Code needs your answer in T3
Code". Each wait posts one report, when the job moves to needs-you, so Juno
hears that the session is waiting and decides what to tell the owner. The
current API cannot answer permission approvals.

## Evidence and owner live checks

S8 in `docs/juno-agent/spikes.md` stopped before authenticated discovery. Its
fake's argument names and `docs/juno-agent/research/opus.md` provide the launch
baseline. The exposed T3 tool descriptions confirm `runtimeMode: full-access`,
`interactionMode: plan`, and `workspaceStrategy: { type: worktree, baseRef,
startFromOrigin }`. No live connection or real content was used here.

After signing in on the owner's loopback connection, check:

- Full-access launch is allowed for this external OAuth client. Confirm one
  Start click creates one session in a new worktree, on the chosen base ref.
- The target thread's branch. The currently exposed `t3_worktree_status({})`
  is caller-scoped and cannot inspect a launched thread. WP18 accepts a
  targeted variant only when its schema declares `threadId` and its result
  confirms that id. The documented `t3_thread_read` binding is the fallback.
- Pending questions: the current list returns `requestIds`; read returns
  `questions`; respond takes `answers` keyed by question id. S8's old fake
  used a different simplified shape. Permission approvals are explicitly
  excluded by the live tool descriptions. Plan approval may therefore need
  an API extension; Juno never guesses or auto-approves it.
- Sign-in expiry and return to the same account. WP17 changes the connection
  epoch on sign-in and supplies no stable account identity. Resuming old jobs
  after that requires a verified identity from WP17, not relaxing the check.
- Session Open: check that T3 Code handles its thread deep link on this Mac.

Plan gaps: S8's `t3_thread_wait` only wakes on terminal state, not questions,
and T3 Code sends no change notification, so the watcher still polls. It reads
again 1 s after it saw a change and doubles the wait up to 10 s while nothing
changes. Between reads it also waits on `t3_thread_wait` when the server offers
it, so a run that ends is seen at once, and an answer Juno sends wakes it. A
server notification or a wait that wakes on pending requests should replace
the poll. Positive launch recovery
reconstructs a missing Task card after a crash between launch and local job
insertion. It does not mint a grant again and never relaunches.

`test/adapters.test.ts` uses real loopback MCP, the manager, scripted provider,
turn engine and dispatcher, with synthetic schemas and content.

A blocked brief records only its call id, run id and time in `tool_blocks`.
The chat renders the fixed Secret blocked note, including after a restart.
No brief or credential is stored in that record.
