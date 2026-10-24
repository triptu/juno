// The code areas bun run affected reads to decide what a change needs beyond the
// tests that reach it (docs/development.md, "Affected tests"):
//
// - HEAVY_AREAS: the tests tagged @heavy, and the code each one checks. A
//   full run (bun run verify:main) always runs them. An affected plan runs an area's heavy
//   tests only when a changed file is in that area.
// - PERF_INTERACTIONS: the interactions with a budget in docs/performance.md,
//   and the files each one owns. The plan suggests perf and feel on the Mac only
//   when one of these changed.
//
// A path ending in / is a folder; any other string is one file; a RegExp
// matches the repo path.

/** Each heavy test carries `@heavy` and its area's tag, as `{ tag: ['@heavy', '@heavy-sync'] }`. */
export const HEAVY_AREAS = [
  {
    area: 'sync',
    suite: 'desktop',
    tag: '@heavy-sync',
    tests: 'the first-sync cases in layout-shift.spec.ts, every test in quick-start.spec.ts, the 429 storm in realtime.spec.ts',
    // Spec files whose every test is heavy: the plan drops them when the area did not change.
    whole: ['apps/desktop/e2e/quick-start.spec.ts'],
    paths: [
      'packages/sync/',
      'packages/engine/src/session/',
      'packages/engine/src/startEngine.ts',
      'packages/engine/src/syncLink.ts',
      'packages/slack/src/client/',
      'packages/fake-slack/src/seeds/',
      'apps/desktop/e2e/layout-shift.spec.ts',
      'apps/desktop/e2e/quick-start.spec.ts',
      'apps/desktop/e2e/realtime.spec.ts',
    ],
  },
  {
    area: 'idle',
    suite: 'desktop',
    tag: '@heavy-idle',
    tests: 'small CPU and memory smoke check, plus fine Mac budgets, in idle-cpu.spec.ts',
    whole: [],
    paths: [
      'apps/desktop/e2e/idle-cpu.spec.ts',
      'apps/desktop/e2e/idleJourney.ts',
      'apps/desktop/src/main/processes.ts',
      'apps/desktop/src/main/processWatch.ts',
      'apps/desktop/src/main/screenWatch.ts',
      'packages/engine/src/send/',
      'packages/engine/src/workerPasses.ts',
      'packages/engine/src/markWorker.ts',
      'packages/agent/src/schedule/scheduler.ts',
      'packages/agent/src/compactor/scheduler.ts',
      'packages/fake-slack/src/seeds/',
    ],
  },
  {
    area: 'gallery',
    suite: 'gallery',
    tag: '@heavy-gallery',
    tests: 'the shift guard over every component (shift.spec.ts without GALLERY_SHIFT_ONLY)',
    whole: [],
    // The gallery harness: the app and its shared helpers, the shift guard, @juno/testing.
    paths: [/^apps\/gallery\/(?!.*\.spec\.ts$)/, 'apps/gallery/shift.spec.ts', 'packages/testing/'],
  },
]

/** Interactions with a budget, the perf.spec.ts tests that time them (`perf`, a title pattern) and their feel scenarios. */
export const PERF_INTERACTIONS = [
  {
    interaction: 'launch',
    perf: 'launch warm start',
    feel: 'launch.feel.ts',
    paths: ['apps/desktop/src/main/index.ts', 'apps/desktop/src/renderer/main.tsx', 'apps/desktop/src/renderer/start.tsx', 'apps/desktop/src/renderer/App.tsx', 'apps/desktop/src/preload/', 'packages/state/src/transport.ts', 'packages/state/src/port.ts', 'packages/state/src/client.ts'],
  },
  {
    interaction: 'topic open, scroll and live updates',
    perf: 'topic open|scroll|live update',
    feel: 'topic.feel.ts',
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
    feel: 'home.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/Home.tsx', 'apps/desktop/src/renderer/containers/HomeComposer.tsx', /^packages\/views\/src\/Home[A-Za-z]*\.tsx$/, /^packages\/state\/src\/home[A-Za-z]*\.ts$/, 'packages/engine/src/home/'],
  },
  {
    interaction: '⌘K open and typing',
    perf: 'palette',
    feel: 'interaction.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/Palette.tsx', 'apps/desktop/src/renderer/containers/PaletteContent.tsx', 'apps/desktop/src/renderer/containers/paletteCommands.ts', 'packages/views/src/CommandPalette.tsx', 'packages/views/src/PaletteRow.tsx', 'packages/state/src/palette.ts', 'packages/engine/src/search/'],
  },
  {
    interaction: 'Search tab: keystroke to results and arrow to reader',
    perf: 'search: arrow to reader',
    feel: 'interaction.feel.ts',
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
    feel: 'topic.feel.ts',
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
    feel: 'chat.feel.ts',
    paths: ['apps/desktop/src/renderer/containers/juno/', 'packages/views/src/juno-chat/', 'packages/views/src/juno-pages/', 'packages/state/src/junoPanel.ts', 'packages/state/src/agent/'],
  },
]

/** Whether a repo path is in one of the paths above. */
export const inPaths = (paths, file) => paths.some((path) => (path instanceof RegExp ? path.test(file) : path.endsWith('/') ? file.startsWith(path) : file === path))

/** The heavy areas a change reaches, by name. */
export const heavyAreasChanged = (changed) => HEAVY_AREAS.filter((area) => changed.some((file) => inPaths(area.paths, file))).map((area) => area.area)

/** The interactions a change reaches, each with the changed files it owns. */
export const perfInteractionsChanged = (changed) =>
  PERF_INTERACTIONS.map((entry) => ({ ...entry, files: changed.filter((file) => inPaths(entry.paths, file)) })).filter((entry) => entry.files.length > 0)
