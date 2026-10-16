import { useState } from 'react'
import { defineFixtures, scene } from '@juno/ui'
import { TourSheet, type TourSheetProps } from './TourSheet'

const noop = () => {}

const at = (step: number, needsProvider = false) => scene<TourSheetProps>(() => <TourSheet step={step} needsProvider={needsProvider} onStep={noop} onClose={noop} onAddProvider={noop} />)

/** Next, Back, the dots and the arrow keys move the steps here, so the shift guard sees a real step change. */
function Stepping() {
  const [step, setStep] = useState(0)
  return <TourSheet step={step} needsProvider onStep={setStep} onClose={() => setStep(0)} onAddProvider={noop} />
}

export default defineFixtures(
  TourSheet,
  {
    // Each step's own picture, in the gallery's theme: the shots run both.
    Steps: {
      topics: at(0),
      'dm-twice': at(1),
      around: at(2),
      yours: at(3),
      juno: at(4),
    },
    'Last step': {
      // No model provider set up: the line and Add a provider.
      'needs-provider': at(4, true),
    },
    Interaction: {
      stepping: scene(() => <Stepping />),
      'focus-next': scene(() => <Stepping />, { focus: '[data-tour-next]' }),
    },
  },
  { width: 820, padded: true, surface: 'subtle' },
)
