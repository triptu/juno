import { largeSeed, seedWorkspace, topic300Seed, type FakeSlackOptions } from '@juno/fake-slack'

/**
 * The seeds a synced start is built on (README, "Synced start"): the default, the 300-message thread on its own, the
 * thread beside the default, and 300 conversations with 1,500 messages over two days. Each is signed in and synced
 * once per run (browser, DOM) or worker (Electron) and copied for every test that asks for it, with
 * `test.use({ synced: true, syncedSeed })` or `domTest(..., { seed })`. Nothing here loads Playwright, so `bun test`
 * workers use it too.
 */
export const SYNCED_SEEDS = {
  default: undefined,
  topic300: (workspace, avatars) => void topic300Seed()(workspace, avatars),
  withTopic300: (workspace, avatars) => {
    seedWorkspace(workspace, avatars)
    topic300Seed()(workspace, avatars)
  },
  conversations300: largeSeed({ users: 60, topics: 150, messages: 1_500, days: 2 }),
} satisfies Record<string, FakeSlackOptions['seed']>

export type SyncedSeed = keyof typeof SYNCED_SEEDS

/** The fake's `seed` option for a synced seed; none for the default. */
export const seedOption = (seed: SyncedSeed = 'default'): Pick<FakeSlackOptions, 'seed'> => {
  const make = SYNCED_SEEDS[seed]
  return make === undefined ? {} : { seed: make }
}

/** What a snapshot or workspace key adds for a seed; nothing for the default, so its key is unchanged. */
export const seedKey = (seed: SyncedSeed = 'default'): { readonly seed?: SyncedSeed } => (seed === 'default' ? {} : { seed })
