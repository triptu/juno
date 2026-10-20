import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../src/detect'

const code = {
  typescript: [
    `export async function fetchTopics(id: string): Promise<Topic[]> {\n  const rows = await db.query<TopicRow>('select * from topics where team = ?', [id])\n  return rows.map((row) => ({ ...row, title: row.title ?? 'Untitled' }))\n}`,
    `interface Props {\n  readonly body: MessageBody\n  readonly now: number\n}`,
    `function Row({ topic }: { topic: TopicRow }) {\n  return <div className="row">{topic.title}</div>\n}`,
    `let total = 0\nfor (const item of cart.items) {\n  total += item.price * item.qty\n}\nconsole.log(total)`,
  ],
  python: [
    `def merge(a, b):\n    """Merge two sorted lists."""\n    out = []\n    while a and b:\n        out.append(a.pop(0) if a[0] < b[0] else b.pop(0))\n    return out + a + b`,
    `import pandas as pd\n\ndf = pd.read_csv("events.csv")\nprint(df.groupby("user_id").size().head(10))`,
    `>>> import json\n>>> json.loads('{"a": 1}')\n{'a': 1}`,
  ],
  sql: [
    `SELECT u.id, count(o.id) AS orders\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nGROUP BY u.id\nORDER BY orders DESC\nLIMIT 20;`,
    `select * from pg_stat_activity where state = 'active';`,
    `insert into flags (name, enabled) values ('new_sidebar', true);`,
  ],
  json: [
    `{\n  "name": "juno",\n  "private": true,\n  "dependencies": { "react": "^19.0.0" }\n}`,
    `[{"id": 1, "ok": true}, {"id": 2, "ok": false}]`,
  ],
  bash: [
    `kubectl get pods -n prod | grep api\nkubectl logs -f deploy/api -n prod --tail=100`,
    `#!/usr/bin/env bash\nset -euo pipefail\nfor f in *.log; do\n  gzip "$f"\ndone`,
    `aws s3 cp ./dist s3://acme-assets/app --recursive`,
  ],
  shell: [`$ pnpm install\n$ pnpm --filter @juno/desktop build`],
} as const

const plain = {
  'a sentence': `Hey team, the deploy is blocked until we get sign-off from security. Can someone ping Maya?`,
  'a sentence that names code': `I think we should use const here instead of let, since the value never changes.`,
  'an instruction that starts with a command word': `make sure you restart the server before testing`,
  'a numbered list': `Steps to reproduce:\n1. Open the app\n2. Click on settings\nExpected: theme switches. Actual: nothing happens.`,
  'a JavaScript stack trace': `TypeError: Cannot read properties of undefined (reading 'map')\n    at TopicList (webpack-internal:///./src/TopicList.tsx:42:18)\n    at renderWithHooks (react-dom.development.js:16305:18)`,
  'a Python traceback': `Traceback (most recent call last):\n  File "/app/worker.py", line 88, in run\n    result = handler(job)\nKeyError: 'id'`,
  'a Java stack trace': `Exception in thread "main" java.lang.NullPointerException\n\tat com.acme.Service.load(Service.java:57)`,
  'a Rust compiler error': "error[E0382]: borrow of moved value: `v`\n --> src/main.rs:4:20\n  |\n2 |     let v = vec![1, 2, 3];",
  'log lines': `2026-10-19T08:12:44.120Z INFO  api  request completed status=200 duration=34ms\n2026-10-19T08:12:45.003Z ERROR api  upstream timeout host=slack.com retry=2`,
  'docker build output': `#1 [internal] load build definition from Dockerfile\n#1 transferring dockerfile: 512B done`,
  'HTTP headers': `HTTP/1.1 200 OK\nContent-Type: application/json\nCache-Control: no-store`,
  'a letter': `Dear all,\n\nPlease find the updated numbers below. Revenue was up 12% this quarter.\n\nThanks,\nPriya`,
  'braces around a note': `{ this is not json, just braces around a note }`,
  'one word': `ERR_CONNECTION_REFUSED`,
}

describe('language detection', () => {
  for (const [language, samples] of Object.entries(code)) {
    it(`finds ${language}`, () => {
      for (const sample of samples) expect(detectLanguage(sample), sample).toBe(language)
    })
  }

  for (const [name, sample] of Object.entries(plain)) {
    it(`leaves ${name} plain`, () => {
      expect(detectLanguage(sample)).toBeUndefined()
    })
  }
})
