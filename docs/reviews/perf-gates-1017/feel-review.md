# Home feel review

Measured on 2026-10-16 in `perf-gates-1017`, on the shared Mac under the
exclusive heavy lock. Only test harness code changed.

`pnpm test:feel -g home` passed Home after idle and exposed a setup mistake
in the new first-sync scenario: subscription discovery can supply a row
before history is released. A focused retry incorrectly required another
eligible row; this fixture has only one during the cold visit. Holding
`subscriptions.thread.getView` before navigation, as the existing layout-shift
tests do, establishes the empty first Home frame. History remains held and
is released during the recording. The corrected `pnpm test:feel -g 'Home fills'`
passed in 8 seconds. These were test setup failures, not observed UI shifts.

The final first-sync recording has 62 compositor frames over 1 second,
load 2.4. All nine checks passed. Greeting, sync text, reserved list and
Ask Juno geometry are in place at frame #7. The row appears during sync
(#19–#21), stays in its slot when sync completes (#23), and holds through
#62. There are zero layout-shift entries and zero row movements or removals.
The existing opacity entrance remains: first-frame geometry does not mean
fully opaque text on that frame. Both filmstrips were inspected.

Home after idle passed in 39 seconds, including its 31-second idle wait:
47 compositor frames, 850 ms recorded, load 2.4. Topic switches to Home at
#7, followed by the existing opacity entrance; no intermediate loading
placeholder appeared.

The final filmstrip and video are in
`apps/desktop/feel-report/home-first-sync/`. The earlier Home-after-idle
artifacts are preserved under
`.juno-status/perf-gates-1017/first-attempt/home-after-idle/`.
Logs are `home.log`, `home-corrected.log` and `home-final.log` in
`.juno-status/perf-gates-1017/`. No further Home scenarios were identified
for this task. No product code or ordinary timing budget was changed.
