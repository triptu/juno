import { afterEach, expect, it, vi } from 'vitest'
import type { FakeFeature } from '../src/features/registry.ts'

afterEach(() => {
  vi.doUnmock('../src/features/index.ts')
  vi.resetModules()
})

it.each([
  { name: 'method reactions.add', feature: { methods: { 'reactions.add': () => ({}) }, controls: {} } },
  { name: 'control addReaction', feature: { methods: {}, controls: { addReaction: () => undefined } } },
] satisfies ReadonlyArray<{ name: string; feature: FakeFeature }>)('starting with a duplicate $name throws', async ({ name, feature }) => {
  vi.resetModules()
  vi.doMock('../src/features/index.ts', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/features/index.ts')>()
    return { features: [...original.features, feature] }
  })
  const { startFakeSlack } = await import('../src/index.ts')
  await expect(startFakeSlack()).rejects.toThrow(`duplicate fake Slack ${name}`)
})
