/**
 * Topic commands whose engine side is not built yet, shared by every
 * place that offers them, so each lands in one spot.
 */

/** Resolve or Reopen, from the row's check and the header's island. */
export function resolveTopic(id: string): void {
  // TODO(M5): run the topic resolve command once the engine has one
  // (resolve, mark read, hide the row, toast with Undo). Nothing to call yet.
  void id
}

/** The header's Juno button and ⌘J in a topic tab. */
export function toggleJunoPanel(): void {
  // TODO(Juno panel): open and close the panel (SPEC 7) once it is built.
}
