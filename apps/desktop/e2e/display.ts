import { spawn } from 'node:child_process'

/**
 * Starts an X server of its own (Linux only) and returns its display, such
 * as `:12`. Workers that share one display stack their windows at the same
 * place, and when another test's window maps or closes over this one, X
 * sends crossing events at the real pointer, which Chromium takes as a
 * mouse move: hover jumps away from where the test put the mouse.
 */
export async function startDisplay(): Promise<{ readonly display: string; readonly stop: () => void }> {
  const xvfb = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] })
  let errors = ''
  xvfb.stderr?.on('data', (chunk: Buffer) => (errors += chunk))
  const number = await new Promise<string>((resolve, reject) => {
    xvfb.stdio[3]?.on('data', (chunk: Buffer) => resolve(String(chunk).trim()))
    xvfb.once('error', reject)
    xvfb.once('exit', (code) => reject(new Error(`Xvfb exited with ${code}: ${errors}`)))
  })
  return { display: `:${number}`, stop: () => xvfb.kill() }
}
