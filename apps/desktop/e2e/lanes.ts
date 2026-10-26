/**
 * Which spec files run in the browser project (README, "Browser lane"). A
 * file here runs in Chrome against a test host; its tests tagged `@electron`
 * run only in the electron project, and those tagged `@canary` run in both.
 * Every other file runs only in the electron project.
 */
export const BROWSER_SPECS: ReadonlyArray<string> = [
  'app.spec.ts',
  'session.spec.ts',
  'juno-agent/t3.spec.ts',
  'juno-agent/panel.spec.ts',
  'juno-agent/chat-reactions.spec.ts',
  'juno-agent/source-link.spec.ts',
  'juno-agent/images.spec.ts',
  'juno-agent/providers-ui.spec.ts',
  'break-pass-1017.spec.ts',
  'emoji-picker-loading.spec.ts',
  'sync-failed.spec.ts',
  'attachments.spec.ts',
  'notification-badge.spec.ts',
  'huddle.spec.ts',
  'welcome.spec.ts',
  'avatars-unfurls.spec.ts',
  'send-checks.spec.ts',
  'tab-scroll.spec.ts',
  'emoji-colon.spec.ts',
  'layout-shift.spec.ts',
  'stick-bottom.spec.ts',
  'quick-reactions.spec.ts',
  'emoji-frequents.spec.ts',
  'all-topics.spec.ts',
  'code-highlight.spec.ts',
  'composer-up.spec.ts',
  'formatting.spec.ts',
  'home-pictures.spec.ts',
  'links.spec.ts',
  'mark-unread.spec.ts',
  'media.spec.ts',
  'mentions.spec.ts',
  'message-menu.spec.ts',
  'search.spec.ts',
  'peek.spec.ts',
  'person-links.spec.ts',
  'reaction-delivery.spec.ts',
  'send-while-staging.spec.ts',
  'send.spec.ts',
  'sidebar-hold.spec.ts',
  'sidebar-motion.spec.ts',
  'sidebar-first-sync.spec.ts',
  'tables.spec.ts',
  'tabs.spec.ts',
  'thread-root.spec.ts',
  'topic.spec.ts',
  'usergroups.spec.ts',
]

/**
 * Electron spec files that start before the rest, slowest first, so a long
 * test does not start last and hold the run open (`e2e/order.ts`). Every
 * other file follows in Playwright's order. Take the order from a run's
 * `e2e-timing` lines (`bun scripts/e2e-timings.mjs <run.log>`).
 */
export const ELECTRON_FIRST: ReadonlyArray<string> = [
  'juno-agent/transfer.spec.ts',
  'juno-agent/crash.spec.ts',
  'juno-agent/backup.spec.ts',
  'file-viewer.spec.ts',
  'app.spec.ts',
  'huddle-share.spec.ts',
  'engine.spec.ts',
  'privacy.spec.ts',
  'break-pass.spec.ts',
]
