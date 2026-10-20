import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A protocol peer, not an allocator: real core and lease proofs run on the laptop.
export function runnerHarness() {
  const dir = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-runner-cli-'))
  const calls = join(dir, 'calls')
  mkdirSync(join(dir, 'scripts/runner'), { recursive: true })
  writeFileSync(join(dir, 'scripts/runner/host.sh'), 'exec node "$TEST_HOST_JS" "$@"\n')
  writeFileSync(join(dir, 'host.cjs'), `const fs = require('node:fs');
const [sub, ...args] = process.argv.slice(2);
const record = value => fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(value)+'\\n');
record({sub,args});
if(sub==='check') { console.log('os=Linux test\\narch=x86_64\\ndocker=28\\ncapacity=8 pinned 4,5,6,7,8,9,10,11'); process.exit(0); }
if(sub==='fetch') { if(process.env.TEST_MODE==='fetch-failed') process.exit(70); process.stdout.write(fs.readFileSync(process.env.TEST_ARTIFACTS)); }
else if(sub==='build') {
 process.stdin.resume(); process.stdin.on('end',()=>process.exit(process.env.TEST_MODE==='build-failed'?70:0));
} else if(sub==='run') {
 const command=args.find(a=>a.startsWith('command=')).slice(8);
 if(process.env.TEST_MODE==='busy') { console.error('__runner_busy\\n__runner_exit 75'); process.exit(75); }
 let data=Buffer.alloc(0), uploaded=false;
 process.stdin.on('data',chunk=>{
  data=Buffer.concat([data,chunk]); const end=data.indexOf(10);
  if(end<0 || uploaded || data.length-end-1<Number(data.subarray(0,end).toString())) return;
  uploaded=true; record({upload:data.length-end-1,expected:Number(data.subarray(0,end).toString())});
  console.log('remote: allocated threads=6');
  if(process.env.TEST_MODE==='hang') return;
  if(process.env.TEST_MODE==='lost') process.exit(0);
  if(command.includes('test:plan')) {
   const scripts=command.includes('specs:conformance')?['specs:conformance']:command.includes('test:gallery')?['test:gallery']:command.includes('test:desktop')?['test:desktop']:['test'];
   scripts.forEach((s,i)=>console.log('plan: step '+i+' '+s+' exited with 0 after 1 s'));
  }
  const code=Number(process.env.TEST_CODE||0);
  if(process.env.TEST_ARTIFACTS) console.error('__runner_artifacts');
  console.error('__runner_exit '+code); process.exit(code);
 });
 process.stdin.on('end',()=>process.exit(130));
 process.on('SIGTERM',()=>{console.error('__runner_exit 130');process.exit(130)});
}
`)
  // Forward only the remote command, preserving its shell quoting.
  writeFileSync(join(dir, 'ssh'), '#!/usr/bin/env node\nconst {spawn}=require("node:child_process"); if(process.env.TEST_MODE==="unreachable") process.exit(255); const c=spawn("sh",["-c",process.argv.at(-1)],{stdio:"inherit"}); c.on("exit",code=>process.exit(code??255));\n')
  writeFileSync(join(dir, 'git'), "#!/bin/sh\nprintf 'package.json\\0scripts/remote.mjs\\0scripts/remote/run.sh\\0'\n")
  writeFileSync(join(dir, 'pnpm'), '#!/bin/sh\nprintf "local: %s\\n" "$*"\n')
  for (const name of ['ssh', 'git', 'pnpm']) chmodSync(join(dir, name), 0o755)
  const env = { ...process.env, HOME: dir, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, TSTACK_HOME: dir, TEST_HOST_JS: join(dir, 'host.cjs'), TEST_CALLS: calls, JUNO_RUNNER_HOST: 'runner-test', JUNO_RUNNER_IMAGE: 'test/image:tag', JUNO_RUNNER_PARENT: undefined, JUNO_RUNNER_PLAN: undefined, JUNO_PLAN_SERIAL: undefined, JUNO_REMOTE_MACHINE: undefined }
  return { dir, calls, env }
}
