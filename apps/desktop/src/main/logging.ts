import { app } from 'electron'
import { installProcessLog } from '../processLog'

export const mainLog = installProcessLog('main')
let closing: Promise<void> | undefined
let closed = false
app.on('before-quit', (event) => {
  // A quit held for the huddle question (index.ts) has not started.
  if (event.defaultPrevented || closed || closing) return
  mainLog.log('INFO', 'process stopping')
  closing = mainLog.close().finally(() => { closed = true })
})
app.on('will-quit', (event) => {
  if (closed || closing === undefined) return
  event.preventDefault()
  void closing.then(() => app.quit())
})
