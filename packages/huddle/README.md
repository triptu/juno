# @juno/huddle

The engine side of huddles (`docs/plans/huddles.md`, SPEC 20). The `Huddle` service runs one user's call by the rules of `specs/huddle.qnt`:

- `lifecycle.ts`: the model's actions as pure functions, under the model's names.
- `running.ts`: running huddles per channel, from room frames (decoded here from the socket's unknown frames) and the edge `huddles/info`.
- `core.ts`: the state. It runs the rules under one lock and does the I/O they call for: `rooms.join`, `rooms.leave` and the stored leave. Leave stops the page's media and sends `rooms.leave` at once; the stored record is cleared only once the media is known stopped (and its request has gone out); the answer to `rooms.leave` is never awaited.
- `attach.ts`: a sync's session and its end; `reads.ts`: room frames and `huddles/info` reads; `slack.ts`: the requests.
- `Huddle.ts`: the service and its public types.

The engine gives it a session per sync (`attach`) with the Slack client, where the pending leaves are stored and the channels to read; see `engine/src/huddle/`. The renderer runs the media session (`apps/desktop/src/renderer/containers/huddle/media.ts`) and reports to it through `huddle.report`.

`alone.ts` is the rule for leaving a call the user has been alone in for 10 minutes (SPEC 20, "The only one left"). `core.ts` keeps one timer for it, checked on every publish, and the leave ends the call as `alone`, so the page shows its toast.

`incoming.ts` is the rule for incoming huddles (SPEC 20, "Incoming huddles"): which running huddles someone else just started where the user is, and when each card goes. The engine decides how each may interrupt and posts its notification (`engine/src/huddle/incoming.ts`).

`status.ts` keeps the "In a huddle" status as the official client does: `users.profile.set` with `huddle_state_expiration_ts` while the call is live, renewed every 240 s or so, and no clearing write on leave.
