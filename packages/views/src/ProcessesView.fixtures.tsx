import { defineFixtures, fixture } from '@juno/ui'
import { ProcessesView, type ProcessRow } from './ProcessesView'

const onCopy = () => {}

// Settings › About's processes as main reads them, at rest on a large workspace, and with the engine busy.
const atRest: ReadonlyArray<ProcessRow> = [
  { name: 'Main', detail: 'Browser, pid 4120', cpu: '0.2 %', memory: '61 MB' },
  { name: 'Window', detail: 'Tab, pid 4125', cpu: '0.4 %', memory: '238 MB' },
  { name: 'Engine', detail: 'Utility, pid 4127', cpu: '0.3 %', memory: '118 MB' },
  { name: 'Juno agent', detail: 'Utility, pid 4131', cpu: '0.1 %', memory: '84 MB' },
  { name: 'Graphics', detail: 'GPU, pid 4122', cpu: '0.5 %', memory: '96 MB' },
  { name: 'Network', detail: 'Utility, pid 4123', cpu: '0.0 %', memory: '22 MB' },
]
const busy = atRest.map((row) => (row.name === 'Engine' ? { ...row, cpu: '101 %' } : row))

export default defineFixtures(ProcessesView, {
  Data: {
    'at-rest': fixture({ rows: atRest, onCopy }),
    'engine-busy': fixture({ rows: busy, onCopy }),
    // Before main's first answer.
    loading: fixture({ rows: [], onCopy }),
  },
  Copy: {
    copied: fixture({ rows: atRest, copied: 'Copied', onCopy }),
    failed: fixture({ rows: atRest, copied: 'Could not copy', onCopy }),
  },
})
