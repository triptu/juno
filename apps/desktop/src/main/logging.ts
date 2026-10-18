import { app } from 'electron'
import { installProcessLog } from '../processLog'

export const mainLog = installProcessLog('main')
let closing: Promise<void> | undefined
let closed = false
app.on('before-quit', () => {
  if (closed || closing) return
  mainLog.log('INFO', 'process stopping')
  closing = mainLog.close().finally(() => { closed = true })
})
app.on('will-quit', (event) => {
  if (closed || closing === undefined) return
  event.preventDefault()
  void closing.then(() => app.quit())
})
