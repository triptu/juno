/** The stored answers Home reads from `ai_cache`: a settled score, the decision's clause, and a title rewrite. Each is undefined when the JSON does not hold it. */

/** The settled decision's probability. */
export const parseScore = (json: string): number | undefined => {
  try {
    const value = JSON.parse(json) as { score?: unknown }
    return typeof value.score === 'number' ? value.score : undefined
  } catch {
    return undefined
  }
}

/** The decision's own clause, when a chat model gave one. */
export const parseReason = (json: string): string | undefined => {
  try {
    const value = JSON.parse(json) as { reason?: unknown }
    return typeof value.reason === 'string' && value.reason.trim() !== '' ? value.reason.trim().replace(/\.$/, '') : undefined
  } catch {
    return undefined
  }
}

/** A title rewrite the assistant was confident about. */
export const parseTitle = (json: string): string | undefined => {
  try {
    const value = JSON.parse(json) as { title?: unknown; confident?: unknown }
    return value.confident === true && typeof value.title === 'string' && value.title.trim() !== '' ? value.title.trim() : undefined
  } catch {
    return undefined
  }
}
