#!/usr/bin/env node
/**
 * Checks that every file `.gitattributes` sends to Git LFS (the images and
 * videos under docs/) is stored as an LFS pointer, not as the file itself.
 * A branch that added screenshots before docs moved to LFS, or a commit made
 * without git-lfs installed, stores the file itself; every checkout then shows
 * it as modified. Reads the index with git alone, so it runs where git-lfs is
 * not installed (CI). Run by `pnpm lint`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (args, input) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...(input === undefined ? {} : { input }) })

// An LFS pointer is a small text file that starts with this line.
const POINTER = 'version https://git-lfs.github.com/spec/v1'
const POINTER_MAX_BYTES = 200

const entries = git(['ls-files', '-s', '-z', '--', 'docs'])
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split('\t')
    return { blob: meta.split(' ')[1], path }
  })
const tracked = new Set(
  git(['check-attr', '-z', '--stdin', 'filter'], entries.map((entry) => `${entry.path}\0`).join(''))
    .split('\0')
    .reduce((rows, field, index, fields) => (index % 3 === 0 && fields[index + 2] === 'lfs' ? [...rows, field] : rows), []),
)
const lfs = entries.filter((entry) => tracked.has(entry.path))
const sizes = git(['cat-file', '--batch-check=%(objectsize)'], lfs.map((entry) => `${entry.blob}\n`).join('')).trim().split('\n').map(Number)
const small = lfs.filter((_, index) => sizes[index] <= POINTER_MAX_BYTES)
// `cat-file --batch` prints a "<sha> blob <size>" line, then the content and a newline.
const output = small.length === 0 ? Buffer.alloc(0) : execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: small.map((entry) => `${entry.blob}\n`).join('') })
const contents = new Map()
for (let at = 0; at < output.length; ) {
  const lineEnd = output.indexOf(0x0a, at)
  const [blob, , size] = output.subarray(at, lineEnd).toString().split(' ')
  contents.set(blob, output.subarray(lineEnd + 1, lineEnd + 1 + Number(size)).toString('latin1'))
  at = lineEnd + 1 + Number(size) + 1
}
const files = lfs.filter((entry) => !(contents.get(entry.blob) ?? '').startsWith(POINTER)).map((entry) => entry.path)

if (files.length > 0) {
  console.error(
    `check-lfs: ${files.length} file(s) under docs/ should be Git LFS pointers but are stored as the files themselves:\n` +
      files.slice(0, 10).map((path) => `  ${path}\n`).join('') +
      (files.length > 10 ? `  ... and ${files.length - 10} more\n` : '') +
      'Fix: install git-lfs (`brew install git-lfs`, then `git lfs install`), run `git add --renormalize docs` and commit.\n' +
      'See docs/development.md, "Git LFS".',
  )
  process.exitCode = 1
} else {
  console.log(`check-lfs: ${lfs.length} LFS file(s) under docs/ are pointers`)
  // Without the hook, a push sends the pointers but not the files they point at.
  const hook = resolve(git(['rev-parse', '--git-common-dir']).trim(), 'hooks/pre-push')
  if (process.env.CI === undefined && !(existsSync(hook) && readFileSync(hook, 'utf8').includes('git-lfs'))) {
    console.log('check-lfs: warning: no Git LFS pre-push hook in this clone; run `git lfs install` before you push')
  }
}
