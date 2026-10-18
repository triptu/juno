import { createLog, logFolder, type LogProcess } from './logging'

let installed: ReturnType<typeof createLog> | undefined

/**
 * The process log and its fatal handlers, installed once per process; later calls get the same logger.
 * An uncaught exception exits every process, since its state may be corrupt. An unhandled rejection
 * exits the engine and the agent, which main restarts, but only logs in main, which nothing restarts.
 */
export function installProcessLog(name: LogProcess, folder = logFolder()) {
  if (installed) return installed
  const logger = createLog(name, folder)
  installed = logger
  console.warn = (...values: unknown[]) => logger.log('WARN', values[0], { error: values[1] })
  console.error = (...values: unknown[]) => logger.log('ERROR', values[0], { error: values[1] })
  const fatal = (event: 'uncaught exception' | 'unhandled rejection', cause: unknown) => {
    logger.log('ERROR', event, { cause })
    // Flush before exiting so the supervisor can restart with the defect on disk.
    const deadline = setTimeout(() => process.exit(1), 1_000)
    void logger.close().finally(() => { clearTimeout(deadline); process.exit(1) })
  }
  process.on('uncaughtException', (cause) => fatal('uncaught exception', cause))
  process.on('unhandledRejection', (cause) => {
    if (name === 'main') logger.log('ERROR', 'unhandled rejection', { cause })
    else fatal('unhandled rejection', cause)
  })
  return logger
}
