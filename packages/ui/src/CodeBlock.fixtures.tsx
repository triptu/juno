import { CodeBlock } from './CodeBlock'
import { defineFixtures, fixture } from './fixtures/define'

const prompt = `In infra/preview-envs, add a reaper that deletes preview environments with no deploys in the last 48 hours.
- Run hourly as a scheduled job
- Skip environments labeled keep=true
- Post a summary of what was deleted to #platform
- Add a dry-run flag and tests for the selection logic`

export default defineFixtures(
  CodeBlock,
  {
    Length: {
      prompt: fixture({ children: prompt, label: 'Prompt' }),
      long: fixture({ children: `${prompt}\n${prompt}\n${prompt}`, label: 'Prompt' }),
      'long-scrolling': fixture({ children: `${prompt}\n${prompt}\n${prompt}`, label: 'Prompt', scroll: true }),
    },
  },
  { width: 520 },
)
