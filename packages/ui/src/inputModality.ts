/**
 * Whether the last input was a key rather than a pointer press, for a panel that moves focus into itself only
 * when opened from the keyboard: Chrome's `:focus-visible` matches after a script moves focus during a press, so
 * it cannot tell. Read when the panel mounts.
 */
let keyboard = false

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => { keyboard = true }, true)
  document.addEventListener('pointerdown', () => { keyboard = false }, true)
}

export function lastInputWasKeyboard(): boolean {
  return keyboard
}
