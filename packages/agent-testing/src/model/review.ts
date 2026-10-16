/**
 * A fake decision model for the auto-review of connection calls (the
 * agent's `ReviewModel`, and OpenRouter's System One endpoint in the fake
 * OpenRouter). It reads the same state the real one does: the owner's words
 * in the run and the proposed call.
 *
 * The default answer is a plain rule, so flows are predictable:
 *
 * - intent: `explicit` when an owner message names the tool's action word
 *   ("update" for `notion-update-page`), `implied` when the owner wrote
 *   something else, `notAsked` when there are no owner words;
 * - risk: `delete` for a tool named like a delete, `send` for one named like
 *   a send, otherwise `reversible`.
 */
export interface FakeReviewRequest {
  readonly state: {
    readonly owner: ReadonlyArray<string>
    readonly call: { readonly server: string; readonly tool: string; readonly args: string }
  }
}

export type FakeIntent = 'explicit' | 'implied' | 'notAsked'
export type FakeRisk = 'reversible' | 'write' | 'delete' | 'send'
export interface FakeReviewAnswers {
  readonly intent: FakeIntent
  readonly risk: FakeRisk
}

const ACTIONS = ['create', 'update', 'append', 'add', 'edit', 'rename', 'move', 'delete', 'remove', 'archive', 'trash', 'send', 'post', 'publish']

export function fakeReview(request: FakeReviewRequest): FakeReviewAnswers {
  const words = request.state.call.tool.toLowerCase().split(/[^a-z]+/)
  const owner = request.state.owner.join('\n').toLowerCase()
  const action = words.find((word) => ACTIONS.includes(word))
  const intent: FakeIntent = owner.trim() === '' ? 'notAsked' : action !== undefined && owner.match(/[a-z0-9_-]+/g)?.includes(action) === true ? 'explicit' : 'implied'
  const risk: FakeRisk = words.some((w) => ['delete', 'remove', 'archive', 'trash'].includes(w)) ? 'delete'
    : words.some((w) => ['send', 'post', 'publish'].includes(w)) ? 'send' : 'reversible'
  return { intent, risk }
}

/** One choice answer in the decision model's shape: all of the probability on `choice`. */
export function choice(value: string, choices: ReadonlyArray<string>, confidence = 0.95) {
  return {
    choice: value,
    confidence,
    probabilities: Object.fromEntries(choices.map((c) => [c, c === value ? confidence : (1 - confidence) / (choices.length - 1)])),
  }
}

const INTENTS = ['explicit', 'implied', 'notAsked']
const RISKS = ['reversible', 'write', 'delete', 'send']

export interface FakeReviewer {
  /** The agent's `ReviewModel`. */
  readonly model: (request: FakeReviewRequest, signal: AbortSignal) => Promise<{ readonly answers: Record<string, ReturnType<typeof choice>>; readonly cost?: number }>
  /** Every request, in order. */
  readonly requests: ReadonlyArray<FakeReviewRequest>
}

/**
 * `answer` decides each review (default `fakeReview`); `fail` makes it reject,
 * `hang` makes it never answer, so the agent's timeout decides.
 */
export function fakeReviewer(answer: ((request: FakeReviewRequest) => FakeReviewAnswers | 'fail' | 'hang') = fakeReview): FakeReviewer {
  const requests: FakeReviewRequest[] = []
  return {
    requests,
    model: (request, signal) => {
      requests.push(request)
      const answers = answer(request)
      if (answers === 'fail') return Promise.reject(new Error('The fake reviewer failed'))
      if (answers === 'hang') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      return Promise.resolve({ answers: { intent: choice(answers.intent, INTENTS), risk: choice(answers.risk, RISKS) }, cost: 0.00003 })
    },
  }
}
