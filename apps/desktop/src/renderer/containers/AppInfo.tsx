import { appInfoAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { AppInfoView } from '@juno/views'

/** The build line from main, for the diagnostics block. */
export function AppInfo() {
  const appInfo = useAtomValue(appInfoAtom)
  const line =
    appInfo._tag === 'Success'
      ? `${appInfo.value.name} ${appInfo.value.version} on ${appInfo.value.platform}, Electron ${appInfo.value.electron}`
      : appInfo._tag === 'Failure'
        ? 'Could not read app info'
        : 'Loading app info'
  return <AppInfoView line={line} compact />
}
