# @juno/huddle

The engine side of huddles (`docs/plans/huddles.md`, SPEC 20). The `Huddle` service runs one user's call by the rules of `specs/huddle.qnt`:

- `lifecycle.ts`: the model's actions as pure functions, under the model's names.
- `running.ts`: running huddles per channel, from room frames (decoded here from the socket's unknown frames) and the edge `huddles/info`.
- `Huddle.ts`: the service. It runs the rules under one lock and does the I/O: `rooms.join`, `rooms.leave` (never awaited), the stored leave, `huddles/info`.

The engine gives it a session per sync (`attach`) with the Slack client, where the pending leaves are stored and the channels to read; see `engine/src/huddle/`. The renderer runs the media session and reports to it through `huddle.media`.

It does not set the "In a huddle" profile status yet (`users.profile.set`); see the plan.
