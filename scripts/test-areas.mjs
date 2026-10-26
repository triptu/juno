// The code areas bun run affected reads to decide what a change needs beyond the
// tests that reach it (docs/development.md, "Affected tests"):
//
// - HEAVY_AREAS: the slow tests tagged @heavy, and the code each one checks. A
//   full run (bun run verify:main) always runs them. An affected plan runs an
//   area's heavy tests only when a changed file is in that area.
// - PERF_INTERACTIONS: the interactions with a budget in docs/performance.md,
//   and the files each one owns. When one of these changed, the plan runs its
//   feel scenario in the browser and suggests perf on the Mac.
// - GUARD_SPECS: desktop specs that guard the most frequent paths. A plan
//   always runs one when a changed file is in its area, whatever the time
//   budget leaves. None now: the instant paths check is
//   a DOM lane file (dom/instant-paths.test.ts), and every change to the
//   renderer, the host or what they import reaches every DOM file.
//
// A path ending in / is a folder; any other string is one file; a RegExp
// matches the repo path.

/** The code the first sync runs, which the cold-sync checks cover. */
const SYNC_PATHS = [
  'packages/sync/',
  'packages/engine/src/session/',
  'packages/engine/src/startEngine.ts',
  'packages/engine/src/syncLink.ts',
  'packages/slack/src/client/',
  'packages/fake-slack/src/seeds/',
  'apps/desktop/e2e/layout-shift.spec.ts',
]

/**
 * Each heavy test carries `@heavy` and its area's tag, as `{ tag: ['@heavy', '@heavy-crash'] }`, in the desktop
 * e2e specs, the DOM lane (`domTest`'s `tag` option) or the gallery. `suite` is where its tests are: `desktop`
 * covers the desktop e2e specs and the DOM lane.
 */
export const HEAVY_AREAS = [
  {
    area: 'sync',
    suite: 'desktop',
    tag: '@heavy-sync',
    tests: 'the sidebar and Home first-sync cases in layout-shift.spec.ts and the quick-start preview',
    paths: [...SYNC_PATHS, 'apps/desktop/e2e/homeSyncProbe.ts'],
  },
  {
    area: 'gallery',
    suite: 'gallery',
    tag: '@heavy-gallery',
    tests: 'the real and computed shift guards over every component (without GALLERY_SHIFT_ONLY)',
    // The gallery harness: the app and its shared helpers, the shift guard, @juno/testing.
    paths: [/^apps\/gallery\/(?!.*\.spec\.ts$)/, 'apps/gallery/shift.spec.ts', 'apps/gallery/computed-shift.spec.ts', 'packages/testing/'],
  },
  {
    area: 'crash',
    suite: 'desktop',
    tag: '@heavy-crash',
    tests: 'the engine kill and inbox crash in juno-agent/crash.spec.ts, the backup and move in backup.spec.ts and the expired relaunch in session.spec.ts; the uncertain write in crash.spec.ts stays on every run',
    paths: [
      'apps/desktop/src/main/agent.ts',
      'apps/desktop/src/main/engine.ts',
      'apps/desktop/src/main/processes.ts',
      'apps/desktop/src/main/processWatch.ts',
      'apps/desktop/src/main/backupSecrets.ts',
      'apps/desktop/src/main/launch.ts',
      'apps/desktop/src/main/session.ts',
      'apps/desktop/src/main/slackSession.ts',
      'apps/desktop/src/agent/',
      'apps/desktop/src/engine/',
      'packages/agent/src/backup/',
      'packages/agent/src/inbox/',
      'packages/agent/src/recovery/',
      'packages/agent/src/ownership/',
      'packages/agent/src/start.ts',
      'packages/engine/src/session/',
      'packages/engine/src/sessionClient.ts',
      'packages/engine/src/startEngine.ts',
      'packages/engine/src/status/',
      'apps/desktop/e2e/juno-agent/crash.spec.ts',
      'apps/desktop/e2e/juno-agent/backup.spec.ts',
      'apps/desktop/e2e/session.spec.ts',
    ],
  },
  {
    area: 'huddle',
    suite: 'desktop',
    tag: '@heavy-huddle',
    tests: 'huddle.spec.ts, huddle-share.spec.ts and the DOM huddle tests that start or join a call',
    paths: [/^(apps|packages)\/.*huddle/i],
  },
  {
    area: 'feel',
    suite: 'desktop',
    tag: '@heavy-feel',
    tests: 'six of the feel scenarios (e2e/feel/*.feel.ts), filmed in the browser; affected plans also run a scenario whose interaction changed (PERF_INTERACTIONS). The rest are @on-demand',
    paths: ['apps/desktop/e2e/feel/'],
  },
]

/** Interactions with a budget, the perf.spec.ts tests that time them (`perf`, a title pattern) and their feel scenarios. */
export const PERF_INTERACTIONS = [
  {
    interaction: 'launch',
    perf: 'launch warm start',
    feel: undefined,
    paths: ['apps/desktop/src/main/index.ts', 'apps/desktop/src/renderer/main.tsx', 'apps/desktop/src/renderer/start.tsx', 'apps/desktop/src/renderer/App.tsx', 'apps/desktop/src/preload/', 'packages/state/src/transport.ts', 'packages/state/src/port.ts', 'packages/state/src/client.ts'],
  },
  {
    interaction: 'topic open, scroll and live updates',
    perf: 'topic open|scroll|live update',
    feel: 'long.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/TopicView.tsx', 'apps/desktop/src/renderer/containers/topic/', 'apps/desktop/src/renderer/containers/messageRows.ts', 'packages/views/src/TopicView.tsx', 'packages/views/src/MessageList.tsx', 'packages/views/src/Message.tsx', 'packages/views/src/MessageBody.tsx', 'packages/state/src/messages.ts', 'packages/state/src/topics.ts', 'packages/engine/src/messages/', 'packages/engine/src/protocol/'],
  },
  {
    interaction: 'sidebar rows, filters, resize and scroll',
    perf: 'row hover|filter change|sidebar drag|scroll frame',
    feel: 'sidebar.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/Sidebar.tsx', 'apps/desktop/src/renderer/containers/TopicList.tsx', 'packages/views/src/Sidebar.tsx', 'packages/views/src/TopicList.tsx', 'packages/views/src/TopicRow.tsx', 'packages/state/src/sidebar.ts', 'packages/state/src/list.ts', 'packages/engine/src/sidebarViews/', 'packages/engine/src/topicRows.ts'],
  },
  {
    interaction: 'Home open and a new tab with Home',
    perf: 'home open|a new tab with Home',
    feel: 'home-write.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/Home.tsx', 'apps/desktop/src/renderer/containers/HomeComposer.tsx', /^packages\/views\/src\/Home[A-Za-z]*\.tsx$/, /^packages\/state\/src\/home[A-Za-z]*\.ts$/, 'packages/engine/src/home/'],
  },
  {
    interaction: '⌘K open and typing',
    perf: 'palette',
    feel: undefined,
    paths: ['apps/desktop/src/renderer/containers/Palette.tsx', 'apps/desktop/src/renderer/containers/PaletteContent.tsx', 'apps/desktop/src/renderer/containers/paletteCommands.ts', 'packages/views/src/CommandPalette.tsx', 'packages/views/src/PaletteRow.tsx', 'packages/state/src/palette.ts', 'packages/engine/src/search/'],
  },
  {
    interaction: 'Search tab: keystroke to results and arrow to reader',
    perf: 'search: arrow to reader',
    feel: undefined,
    paths: [/^apps\/desktop\/src\/renderer\/containers\/search\//, /^packages\/views\/src\/search\//, 'packages/state/src/search.ts', 'packages/engine/src/search/'],
  },
  {
    interaction: 'typing, mentions and send',
    perf: 'keystroke controls|typing|send',
    feel: 'composer.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/TopicComposer.tsx', 'apps/desktop/src/renderer/containers/mentions.tsx', 'apps/desktop/src/renderer/containers/suggestionList.tsx', 'apps/desktop/src/renderer/containers/emojiSuggestions.tsx', 'packages/views/src/Composer.tsx', 'packages/views/src/MentionSuggestions.tsx', 'packages/state/src/send.ts', 'packages/state/src/mentions.ts', 'packages/engine/src/send/', 'packages/engine/src/mentions/'],
  },
  {
    interaction: 'peek',
    perf: 'peek',
    feel: undefined,
    paths: ['apps/desktop/src/renderer/containers/Peek.tsx', 'apps/desktop/src/renderer/containers/PeekTopic.tsx', 'packages/views/src/PeekView.tsx', 'packages/state/src/peek.ts'],
  },
  {
    interaction: 'tab switch',
    perf: 'tab switch',
    feel: 'tabs.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/Workspace.tsx', 'packages/views/src/Workspace.tsx', 'packages/views/src/WorkspaceStrip.tsx', 'packages/ui/src/TabStrip.tsx', 'packages/state/src/tabs.ts'],
  },
  {
    interaction: 'media viewer open',
    perf: 'media viewer open',
    feel: undefined,
    paths: ['apps/desktop/src/renderer/containers/MediaViewerPanel.tsx', 'packages/views/src/MediaViewer.tsx', 'packages/views/src/Filmstrip.tsx'],
  },
  {
    interaction: 'All topics',
    perf: 'All topics',
    feel: undefined,
    paths: ['apps/desktop/src/renderer/containers/AllTopics.tsx', 'packages/views/src/AllTopics.tsx', 'packages/state/src/allTopics.ts'],
  },
  {
    interaction: 'the Juno panel and chat',
    perf: 'send to your bubble|drag a selection',
    feel: undefined,
    paths: ['apps/desktop/src/renderer/containers/juno/', 'packages/views/src/juno-chat/', 'packages/views/src/juno-pages/', 'packages/state/src/junoPanel.ts', 'packages/state/src/agent/'],
  },
]

/** Specs a plan requires when a change is in their area. */
export const GUARD_SPECS = []

/** Whether a repo path is in one of the paths above. */
export const inPaths = (paths, file) => paths.some((path) => (path instanceof RegExp ? path.test(file) : path.endsWith('/') ? file.startsWith(path) : file === path))

/** The heavy areas a change reaches, by name. */
export const heavyAreasChanged = (changed) => HEAVY_AREAS.filter((area) => changed.some((file) => inPaths(area.paths, file))).map((area) => area.area)

/** The interactions a change reaches, each with the changed files it owns. */
export const perfInteractionsChanged = (changed) =>
  PERF_INTERACTIONS.map((entry) => ({ ...entry, files: changed.filter((file) => inPaths(entry.paths, file)) })).filter((entry) => entry.files.length > 0)

/**
 * The full run's feel scenarios among `files`: the feel project's files that hold a `@heavy-feel` test, read through
 * `read`; the others are `@on-demand`. `own` marks those an affected plan runs: a changed scenario, every one when
 * their harness changed, and the scenario of a changed interaction (`interactions`, from perfInteractionsChanged).
 */
export function feelScenarios(files, changed, interactions, read) {
  const harness = changed.some((file) => file.startsWith('apps/desktop/e2e/feel/') && !file.endsWith('.feel.ts'))
  const named = new Set([...changed, ...interactions.flatMap((entry) => (entry.feel ? [`apps/desktop/e2e/feel/${entry.feel}`] : []))])
  return files.filter((file) => /^apps\/desktop\/e2e\/feel\/[^/]+\.feel\.ts$/.test(file) && read(file).includes("'@heavy-feel'")).map((file) => ({ file, own: harness || named.has(file) }))
}

/** The guard specs a change reaches, each with the first changed file in its area. */
export const guardSpecsChanged = (changed) =>
  GUARD_SPECS.flatMap((entry) => {
    const file = changed.find((path) => inPaths(entry.paths, path))
    return file === undefined ? [] : [{ spec: entry.spec, guards: entry.guards, file }]
  })
