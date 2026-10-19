import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the public CLI through fake transports, including workspace streaming.
export function runnerHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'juno-runner-cli-'))
  const calls = join(dir, 'calls')
  writeFileSync(join(dir, 'ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv.at(-1);
fs.appendFileSync(process.env.TEST_CALLS, 'ssh\\n');
if (process.env.TEST_MODE === 'unreachable') process.exit(255);
if (process.env.TEST_MODE === 'auth') { console.error('Permission denied (publickey)'); process.exit(255); }
if (command.includes('docker build')) {
 if (process.env.TEST_MODE === 'build-failed') { console.error('Docker build failed'); process.exit(1); }
 let bytes = 0; process.stdin.on('data', chunk => bytes += chunk.length);
 process.stdin.on('end', () => { fs.appendFileSync(process.env.TEST_CALLS, 'build ' + bytes + '\\n'); console.error('#1 DONE 0.1s'); });
} else if (command.includes('__juno_runner_connected')) {
 if (process.env.TEST_MODE === 'broken') { console.error('Docker unavailable'); process.exit(1); }
 console.log('__juno_runner_connected\\njuno-runner-ready ' + (process.env.TEST_CAPACITY || '4') + (process.env.TEST_PINNED ? ' 1' : ''));
} else if (command.includes('__juno_remote_exit_')) {
 const threads = process.env.TEST_PINNED ? Number(command.match(/ -- (\\d+) '/)[1]) * 2 : undefined;
 fs.appendFileSync(process.env.TEST_CALLS, 'reservation ' + command.match(/ -- (\\d+) '/)[1] + ' cpus ' + (threads ?? command.match(/--cpus (\\d+)/)[1]) + ' job-cores ' + (threads ?? command.match(/JUNO_RUNNER_JOB_CORES=(\\d+)/)[1]) + '\\n');
 fs.appendFileSync(process.env.TEST_CALLS, 'wide-unit ' + command.match(/JUNO_RUNNER_WIDE_UNIT=(\\d+)/)[1] + '\\n');
 if (process.env.TEST_MODE === 'busy') { console.log('__juno_remote_started\\n__juno_remote_busy\\n__juno_remote_released'); process.exit(75); }
 fs.appendFileSync(process.env.TEST_CALLS, (command.includes('JUNO_REMOTE_INSTALL=1') && command.includes('PNPM_CONFIG_STORE_DIR=/cache/pnpm-store') && command.includes('--user') ? 'install with cache' : 'full image') + '\\n');
 const marker = command.match(/__juno_remote_exit_[\\w-]+=/)[0];
 let bytes = 0; process.stdin.on('data', chunk => { bytes += chunk.length });
 process.stdin.on('end', () => {
   fs.appendFileSync(process.env.TEST_CALLS, 'workspace ' + bytes + '\\n');
   if (process.env.TEST_MODE === 'plan') {
     const scripts = command.includes('test:gallery') ? ['test:gallery', 'test:desktop'] : command.includes('specs:conformance') ? ['specs:conformance'] : ['test'];
     for (const [index, script] of scripts.entries()) console.log('plan: step ' + index + ' ' + script + ' exited with 0 after 1 s');
   }
   console.log('__juno_remote_started\\n__juno_remote_ready\\nremote: script time 1 s\\n' + marker + (process.env.TEST_MODE === 'plan' ? '0' : '7'));
 });
} else if (command.includes('docker image inspect')) {
 if (command.includes('__juno_image_present')) console.log('__juno_image_missing');
 else if (['build', 'build-failed'].includes(process.env.TEST_MODE)) process.exit(1);
} else { process.stdin.resume(); }
`)
  writeFileSync(join(dir, 'nsc'), '#!/bin/sh\necho nsc >> "$TEST_CALLS"\necho not-json\n')
  writeFileSync(join(dir, 'git'), "#!/bin/sh\nprintf 'package.json\\0scripts/remote.mjs\\0scripts/remote/run.sh\\0'\n")
  chmodSync(join(dir, 'git'), 0o755)
  chmodSync(join(dir, 'ssh'), 0o755)
  chmodSync(join(dir, 'nsc'), 0o755)
  const env = { ...process.env, HOME: dir, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, TEST_CALLS: calls, JUNO_RUNNER_HOST: 'runner-test', JUNO_RUNNER_IMAGE: 'test/image:tag', JUNO_REMOTE_MAX_VCPU: '0' }
  return { dir, calls, env }
}

