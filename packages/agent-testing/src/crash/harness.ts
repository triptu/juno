/**
 * Runs an agent process to a named crash point, and simulates power loss.
 *
 * `runAgent` starts a program with `JUNO_AGENT_CRASH_AT` set and waits for it
 * to end. `crashAt` also requires that it died of SIGKILL, so a point that is
 * renamed or never reached fails the test with the spec transition it stands
 * for. A crash after a FULL commit leaves the files exactly as committed, so
 * `snapshotFiles` taken then is a snapshot at that commit boundary.
 * `restore` puts it back over a later state: that is power loss, or a restore
 * of an older file such as the journal behind the archive (spec `rollback`).
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CRASH_ENV, CRASH_POINTS, type CrashPoint } from './points'

export interface RunOptions {
  /** Default: this Node. */
  readonly command?: string
  readonly args: ReadonlyArray<string>
  readonly env?: Record<string, string>
  readonly cwd?: string
  /** A point, or a point and the hit to crash on. */
  readonly crashAt?: CrashPoint | `${CrashPoint}:${number}`
  /** Default 30 s. The process is killed after it, and the run rejects. */
  readonly timeoutMs?: number
}

export interface AgentRun {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  /** True when the process died of SIGKILL, that is, at the crash point. */
  readonly crashed: boolean
  readonly stdout: string
  readonly stderr: string
}

export function runAgent(options: RunOptions): Promise<AgentRun> {
  if (options.crashAt !== undefined && !((options.crashAt.split(':')[0] ?? '') in CRASH_POINTS)) {
    return Promise.reject(new Error(`unknown crash point ${options.crashAt}`))
  }
  const env = { ...process.env, ...options.env, ...(options.crashAt ? { [CRASH_ENV]: options.crashAt } : {}) }
  if (!options.crashAt) delete env[CRASH_ENV]
  return new Promise((resolve, reject) => {
    const child = spawn(options.command ?? process.execPath, [...options.args], { env, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`agent did not finish in ${options.timeoutMs ?? 30_000} ms\n${stderr}`))
    }, options.timeoutMs ?? 30_000)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, crashed: signal === 'SIGKILL', stdout, stderr })
    })
  })
}

/** Runs to `point` and requires the crash. */
export async function crashAt(point: CrashPoint | `${CrashPoint}:${number}`, options: Omit<RunOptions, 'crashAt'>): Promise<AgentRun> {
  const run = await runAgent({ ...options, crashAt: point })
  if (!run.crashed) {
    const spec = CRASH_POINTS[point.split(':')[0] as CrashPoint]
    throw new Error(`agent never reached crash point ${point} (${spec.spec}: after \`${spec.after}\`, before \`${spec.before}\`); it exited with ${run.signal ?? run.code}\n${run.stderr}`)
  }
  return run
}

export interface FileSnapshot {
  /** The file names captured. */
  readonly files: ReadonlyArray<string>
  /**
   * Puts the captured files back in the directory. Files in the directory
   * that match `only` but were not captured are deleted, as a `-wal` written
   * after the snapshot would be lost with the power.
   */
  readonly restore: (only?: (name: string) => boolean) => void
  readonly discard: () => void
}

/** Copies the regular files of `dir` (not subdirectories). Take it only while no process writes there. */
export function snapshotFiles(dir: string): FileSnapshot {
  const copy = mkdtempSync(join(tmpdir(), 'juno-snapshot-'))
  const files = readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile())
  for (const name of files) copyFileSync(join(dir, name), join(copy, name))
  return {
    files,
    restore: (only = () => true) => {
      for (const name of readdirSync(dir)) {
        if (only(name) && statSync(join(dir, name)).isFile() && !files.includes(name)) rmSync(join(dir, name))
      }
      for (const name of files) if (only(name)) copyFileSync(join(copy, name), join(dir, name))
    },
    discard: () => rmSync(copy, { recursive: true, force: true }),
  }
}

/** The pi-durable journal files, with their WAL and shared-memory siblings (plan v3 §2.2). */
export const journalFiles = (name: string) => /^pi-.+\.sqlite(-wal|-shm|-journal)?$/.test(name)
/** `agent.sqlite` and its siblings. */
export const agentDatabaseFiles = (name: string) => /^agent\.sqlite(-wal|-shm|-journal)?$/.test(name)
