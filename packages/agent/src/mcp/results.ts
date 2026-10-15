/** The archive already keeps every tool result as an attachment keyed by its first message. */
export function pageMcpResult(toolName: string | undefined, text: string, attachment: number): string {
  if ((toolName !== 'call_tool' && toolName !== 'find_tools') || Buffer.byteLength(text) <= 20_000) return text
  return `Untrusted connection result saved as attachment on message ${attachment}. The result exceeds 20 KB and is not included here. Tell the owner it was cut.`
}
