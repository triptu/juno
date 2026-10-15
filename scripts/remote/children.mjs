/** Let remote children finish their cleanup when a runner is cancelled. */
export function forwardSignals(children) {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      process.exitCode = 130
      for (const child of children) child.kill(signal)
    })
  }
}
