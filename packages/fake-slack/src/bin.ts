/**
 * Runs the fake on its own: `pnpm --filter @juno/fake-slack start`.
 * PORT and HOST override the defaults (8788, 127.0.0.1).
 */
import { startFakeSlack } from './index.ts'

const port = Number(process.env['PORT'] ?? 8788)
const host = process.env['HOST'] ?? '127.0.0.1'

const fake = await startFakeSlack({ port, host })
const credentials = fake.credentials()
console.log(`fake-slack listening at ${fake.url}`)
console.log(`sign-in page:  ${fake.url}/signin`)
console.log(`team ${credentials.teamId}, user ${credentials.userId}`)
console.log(`default token: ${credentials.token}`)
console.log(`default cookie: d=${credentials.cookie}`)
console.log('controls: POST /control/<name> with a JSON body (injectMessage, markRead, force429, dropSocket, expireSession, advanceClock, ...)')

const stop = () => {
  fake.close().then(() => process.exit(0), () => process.exit(1))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
