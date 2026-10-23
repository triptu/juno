# Notification replay

A dev-only tool for setting the notification constants from your own messages: `INSTRUCTION_NOTIFY_CONFIDENCE`, `INSTRUCTION_STAY_CONFIDENCE`, `NEEDS_YOU_THRESHOLD` and `LIVE_MINUTES` in `packages/domain/src/notificationDecision.ts`.

Everything it writes holds real Slack content. Keep `--out` and `--dir` under `/Volumes/AgentWork/scratch/`, never in the repo.

## Steps

1. Replay. It copies the app's store to `<out>/store` (the app's folder is only read), finds every notification candidate of the last N days (DMs, group DMs, mentions, replies in threads you follow or started, anything set to Always), and decides each one as of its own time. The facts come only from messages before it. The reading goes to the real classifier on OpenRouter, using `OPENROUTER_API_KEY` from the environment, the repo's `.env` or the main checkout's `.env`.

   ```sh
   bun run notif:replay run --out /Volumes/AgentWork/scratch/notif-replay/run --days 21
   ```

   Flags: `--data <workspace folder>` (default: the only folder under `~/Library/Application Support/Juno/workspaces`), `--concurrency 4`, `--instructions <file>` (a JSON list of `{ id, direction, text }` to replay with instead of your saved instructions), `--env <file>`. Readings are cached in `<out>/readings` by their input, so a rerun costs nothing. Failed readings are not cached. It writes `<out>/replay.json`, with the old check's decision where the old notification log has the message.

2. Sample and label. `sample` picks about 300 messages, stratified by what decided them and the kind of conversation, with borderline readings oversampled. `label` serves the page and saves `labels.json` next to it.

   ```sh
   bun run notif:replay sample --replay /Volumes/AgentWork/scratch/notif-replay/run/replay.json --out /Volumes/AgentWork/scratch/notif-labels
   bun run notif:replay label --dir /Volumes/AgentWork/scratch/notif-labels
   ```

   On the page, N is Notify, D is Don't notify and U undoes the last label. The page does not show what Juno decided.

3. Report.

   ```sh
   bun run notif:replay report --replay /Volumes/AgentWork/scratch/notif-replay/run/replay.json --labels /Volumes/AgentWork/scratch/notif-labels/labels.json
   ```

   It prints agreement, recall and precision for the new decision and the old one, the misses and extra banners grouped by what decided them, and a sweep of each constant: notifications a day against recall. It recommends, for each constant, the value with the fewest notifications a day whose recall on messages that reach Auto is at least `--recall` (0.9). Rates are weighted by how many replayed messages each label stands for. `--show-text` adds the message text to the lists.

## Limits

- Whether you followed a thread is read as it is now, not as it was when the reply came.
- The burst rule is played from the replay's own banners, at message times. The focused-window check is not replayed.
- The replay waits up to 20 s for a reading. The run says how many took more than the app's 2 s.
- The instruction thresholds can be measured only when the replay has instructions and the reading chose them.
