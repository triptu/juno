# Backlog

Small items noticed during work that are not yet assigned to a milestone. Remove an item when it is done.

- `pnpm test` was SIGKILLed once right after `pnpm install` (could not reproduce in 8 runs). Watch for it; if it recurs, find the package and check vitest worker memory and timeouts.
- Identity-provider sign-in (Google, Okta) leaves slack.com and is blocked by the sign-in window allow-list. The Slack-app import covers it for now.
- The socket does not use the system proxy yet: main resolves it, but no `ws` agent is passed.
- `pnpm smoke:live` always imports from the Slack app; it cannot reuse `secrets.bin` outside Electron.
- After the body-sniff sign-in fallback, `secrets.bin` keeps `userId: ''` until a later sign-in.
- A lint rule that bans raw colour and size values in components (StyleX does not enforce token use).
