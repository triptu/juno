import { createLog } from './logging'

const installed = new Map<string, ReturnType<typeof createLog>>()

export function installProcessLog(name: 'main' | 'engine' | 'agent') {
  const previous = installed.get(name)
  if (previous) return previous
  const logger = createLog(name)
  installed.set(name, logger)
  console.warn = (...values: unknown[]) => logger.log('WARN', values[0], { error: values[1] })
  console.error = (...values: unknown[]) => logger.log('ERROR', values[0], { error: values[1] })
  const fatal = (event: 'uncaught exception' | 'unhandled rejection', cause: unknown) => {
    logger.log('ERROR', event, { cause })
    // Flush before exiting so the supervisor can restart with the defect on disk.
    const deadline = setTimeout(() => process.exit(1), 1_000)
    void logger.close().finally(() => { clearTimeout(deadline); process.exit(1) })
  }
  process.on('uncaughtException', (cause) => fatal('uncaught exception', cause))
  process.on('unhandledRejection', (cause) => fatal('unhandled rejection', cause))
  return logger
}
