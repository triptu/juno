import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { audienceCheck, type PickConversation, type SendTarget } from '@juno/contract'
import { aiAssistOnAtom, checkMessage, precheckMessage, registry, sendCheckPrefsAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { AudienceWarning } from '@juno/views'
import { preloadBar, sendCheck, SendCheckPanel } from './sendCheckChunk'
import { afterCheck, choose, type CheckBar, type Destination, type Outcome } from './sendChecks'

/** Home's send checks (SPEC 8): only on a channel already chosen. Enter reads cached findings, never a model. */
export function useHomeSendChecks(text: string, target: SendTarget | undefined, deliver: (text: string, to: Destination) => void, conversation: PickConversation | undefined) {
  const enabled = useAtomValue(aiAssistOnAtom)
  const wrongPlace = useAtomValue(sendCheckPrefsAtom).some((check) => check.key === 'wrongPlace' && check.enabled)
  const checking = useRef<object | undefined>(undefined)
  const channelId = target?.kind === 'channel' ? target.channelId : undefined
  const threadTs = target?.kind === 'channel' ? target.threadTs : undefined
  const key = useMemo(() => ({ text, channelId, threadTs, enabled }), [text, channelId, threadTs, enabled])
  const [finding, setFinding] = useState<{ key: object; bar: CheckBar | undefined }>()
  const [warning, setWarning] = useState<{ key: object; message: string }>()
  const [waitingFor, setWaitingFor] = useState<object>()
  const bar = finding?.key === key ? finding.bar : undefined
  const setBar = (bar: CheckBar | undefined) => setFinding({ key, bar })
  const setWaiting = (waiting: boolean) => setWaitingFor(waiting ? key : undefined)
  const clear = () => {
    checking.current = undefined
    setWaiting(false)
    setBar(undefined)
  }
  useEffect(preloadBar, [])
  useLayoutEffect(() => {
    checking.current = undefined
    return () => { checking.current = undefined }
  }, [text, channelId, threadTs, enabled])
  useEffect(() => {
    if (!enabled || channelId === undefined || text.trim() === '') return
    const timer = setTimeout(() => {
      if (wrongPlace) precheckMessage(registry, channelId, text, threadTs)
      const found = conversation === undefined ? undefined : audienceCheck(text, conversation)
      if (found !== undefined) setWarning({ key, message: found.message })
    }, 400)
    return () => clearTimeout(timer)
  }, [text, channelId, threadTs, enabled, wrongPlace, conversation, key])
  const follow = (outcome: Outcome) => {
    if (outcome.kind === 'bar') setBar(outcome.bar)
    else {
      setBar(undefined)
      if (outcome.kind === 'send') deliver(outcome.text, outcome.to)
    }
  }
  const pick = (choice: 'primary' | 'secondary') => {
    if (bar !== undefined) follow(choose(bar, choice))
  }
  const send = () => {
    if (bar !== undefined) return pick('primary')
    if (checking.current !== undefined) return
    // Only Wrong place runs before sending, and only in Main. Anything else sends at once.
    if (!enabled || !wrongPlace || channelId === undefined || threadTs !== undefined || text.trim() === '') return deliver(text, { kind: 'here' })
    const token = {}
    checking.current = token
    setWaiting(true)
    void checkMessage(registry, { channelId, ...(threadTs === undefined ? {} : { threadTs }) }, text).then(async found => {
      const outcome = afterCheck(text, found)
      // Publish the bar with its final geometry, even when Enter beats the idle preload.
      if (outcome.kind === 'bar') await sendCheck.load()
      if (checking.current !== token) return
      checking.current = undefined
      setWaiting(false)
      follow(outcome)
    })
  }
  const notices = <>
    {warning?.key === key ? <AudienceWarning message={warning.message} /> : null}
    {bar === undefined ? null : <SendCheckPanel bar={bar} onPick={pick} />}
  </>
  return { send, waiting: waitingFor === key, clear, notices }
}
