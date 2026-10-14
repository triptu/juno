import { defineFixtures, fixture } from '@juno/ui'
import { memory, NOW } from './fixtures'
import { MemoryPage, type MemoryPageProps } from './MemoryPage'

const page = (props: Pick<MemoryPageProps, 'page'>) => fixture<MemoryPageProps>({ ...props, now: NOW })

export default defineFixtures(
  MemoryPage,
  {
    Memory: {
      timeline: page({ page: memory }),
      empty: page({ page: { lines: [] } }),
    },
  },
  { width: 960, height: 640, padded: false },
)
