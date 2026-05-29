// Tracks the "Enter" action of the currently focused tile, so the phone remote's
// OK button can fire it (norigin has no public "press enter on focused" call).
let currentEnter: (() => void) | null = null;

export function setCurrentEnter(fn: (() => void) | null) {
  currentEnter = fn;
}

export function fireEnter() {
  currentEnter?.();
}
