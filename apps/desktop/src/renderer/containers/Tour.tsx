import { useEffect } from 'react'
import { closeTour, holdMenuCommands, registry, tourOpenAtom, tourStepAtom } from '@juno/state'
import { agentProviderAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { SheetLayer, TourSheet, tourSteps } from '@juno/views'
import { openSettings } from './navigation'

/** Moves to `step`, kept inside the tour. */
function goTo(step: number): void {
  registry.set(tourStepAtom, Math.min(tourSteps.length - 1, Math.max(0, step)))
}

function close(): void {
  closeTour(registry)
}

/**
 * The tour (SPEC 4.1) over the app: by itself once per workspace, after
 * the first sign-in, and whenever Help, ⌘K or Settings › About asks for
 * it. While it shows it holds the app menu, so ⌘[ and ⌘] (Back and
 * Forward) move its steps and no other shortcut reaches the window under it.
 */
export function Tour() {
  const open = useAtomValue(tourOpenAtom)
  return open ? <OpenTour /> : null
}

function OpenTour() {
  const step = useAtomValue(tourStepAtom)
  const needsProvider = useAtomValue(agentProviderAtom, (state) => state?.active === null)
  useEffect(
    () =>
      holdMenuCommands((command) => {
        if (command === 'history.back') goTo(registry.get(tourStepAtom) - 1)
        else if (command === 'history.forward') goTo(registry.get(tourStepAtom) + 1)
      }),
    [],
  )
  return (
    <SheetLayer onClose={close}>
      <TourSheet
        step={step}
        needsProvider={needsProvider}
        onStep={goTo}
        onClose={close}
        onAddProvider={() => {
          close()
          openSettings('juno')
        }}
      />
    </SheetLayer>
  )
}
