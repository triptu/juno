/**
 * The share sheet (SPEC 20, "Sharing your own"), a lazy chunk: the screens
 * and windows main lists, taken once as it opens, or why there are none
 * (macOS Screen Recording). While recording is not allowed it asks main
 * again each time the window regains focus. Share starts sharing the pick
 * and closes the sheet.
 */
import { useEffect, useState } from 'react'
import type { ShareSource, ShareSources } from '@juno/contract'
import { ScreenSourcePicker, type ScreenSource } from '@juno/huddle-views'
import { allowScreenRecording, getShareSources, getSharingSetting, openScreenRecordingSettings } from '@juno/state'
import { shareScreen } from './media'
import { closeSharePicker } from './shareSheet'

const toView = (source: ShareSource): ScreenSource => ({
  id: source.id,
  name: source.name,
  kind: source.kind,
  ...(source.thumbnail === undefined ? {} : { thumbnailUrl: source.thumbnail }),
  ...(source.appIcon === undefined ? {} : { appIconUrl: source.appIcon }),
})

export default function SharePicker() {
  const [listed, setListed] = useState<ShareSources | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [hidesText, setHidesText] = useState(false)

  useEffect(() => {
    let active = true
    void getShareSources().then((sources) => active && setListed(sources))
    void getSharingSetting().then((setting) => active && setHidesText(setting?.hide === true && setting.detection === 'available'))
    return () => {
      active = false
    }
  }, [])

  // Until macOS allows recording, the answer may change in System Settings: ask again on focus.
  const granted = listed?.permission === 'granted'
  useEffect(() => {
    if (listed === undefined || granted) return
    let active = true
    const recheck = () => void getShareSources().then((sources) => active && setListed(sources))
    window.addEventListener('focus', recheck)
    return () => {
      active = false
      window.removeEventListener('focus', recheck)
    }
  }, [listed, granted])

  const share = (id: string) => {
    const source = listed?.sources.find((each) => each.id === id)
    if (source === undefined) return
    closeSharePicker()
    void shareScreen({ sourceId: source.id, kind: source.kind, name: source.name })
  }

  return (
    <ScreenSourcePicker
      permission={listed?.permission ?? 'granted'}
      {...(listed === undefined ? {} : { sources: listed.sources.map(toView) })}
      {...(chosen === undefined ? {} : { chosen })}
      hidesText={hidesText}
      onChoose={setChosen}
      onShare={share}
      onCancel={closeSharePicker}
      onAllow={() => void allowScreenRecording().then(setListed)}
      onOpenSettings={openScreenRecordingSettings}
    />
  )
}
