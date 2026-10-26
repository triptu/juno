/**
 * Runs an agent process to a named crash point, and restores commit snapshots.
 *
 * `runAgent` starts a program with `JUNO_AGENT_CRASH_AT` set and waits for it
 * to end. `crashAt` also requires that it died of SIGKILL, so a point that is
 * renamed or never reached fails the test with the spec transition it stands
 * for. A crash after a FULL commit leaves the files exactly as committed, so
 * `snapshotFiles` taken then is a snapshot at that commit boundary.
 * `restore` puts it back over a later state to model lost writes or an older
 * file such as the journal behind the archive (spec `rollback`). It does not
 * discard the OS or drive cache, so it cannot verify hardware flushes.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CRASH_ENV, CRASH_POINTS, type CrashPoint } from './points'

export interface RunOptions {
  /** Default: this Bun, running a `.ts` program from a bundle. */
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

// Loading a program's module graph from source took most of a short run: 0.5 to 0.9 s per start on the
// shared laptop. Under Bun, a `.ts` program is bundled once per test process and each run starts the bundle.
// The bundle lands in the shared temp cache under the hash of its contents, so equal bundles share a file.
const bundles = new Map<string, Promise<string>>()
type Bundler = { build(options: { entrypoints: Array<string>; target: 'bun' }): Promise<{ success: boolean; logs: Array<unknown>; outputs: Array<{ text(): Promise<string> }> }> }

function bundled(program: string): Promise<string> {
  const bun = (globalThis as { Bun?: Bundler }).Bun
  if (bun === undefined || !program.endsWith('.ts')) return Promise.resolve(program)
  let bundle = bundles.get(program)
  if (bundle === undefined) {
    bundle = bun.build({ entrypoints: [program], target: 'bun' }).then(async (result) => {
      const output = result.outputs[0]
      if (!result.success || output === undefined) throw new Error(`could not bundle ${program}\n${result.logs.join('\n')}`)
      const text = await output.text()
      const dir = join(tmpdir(), 'juno-cache', 'agent-programs')
      const file = join(dir, `${createHash('sha256').update(text).digest('hex').slice(0, 32)}.js`)
      if (!existsSync(file)) {
        mkdirSync(dir, { recursive: true })
        const temporary = `${file}.${process.pid}`
        writeFileSync(temporary, text)
        renameSync(temporary, file)
      }
      return file
    })
    bundles.set(program, bundle)
  }
  return bundle
}

export async function runAgent(options: RunOptions): Promise<AgentRun> {
  if (options.crashAt !== undefined && !((options.crashAt.split(':')[0] ?? '') in CRASH_POINTS)) {
    throw new Error(`unknown crash point ${options.crashAt}`)
  }
  const env: Record<string, string | undefined> = { ...process.env, ...options.env, ...(options.crashAt ? { [CRASH_ENV]: options.crashAt } : {}) }
  if (!options.crashAt) delete env[CRASH_ENV]
  const [program, ...rest] = options.args
  const args = options.command === undefined && program !== undefined ? [await bundled(program), ...rest] : [...options.args]
  return new Promise((resolve, reject) => {
    const child = spawn(options.command ?? process.execPath, args, { env, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
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
