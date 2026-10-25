// Keyboard shortcuts written as text ("Mod+Shift+F"): matching them against key events, and showing them.
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

type Combo = {mod: boolean; shift: boolean; alt: boolean; key: string};
function parse(spec: string): Combo {
  const parts = spec.split('+').map(p => p.trim());
  const key = parts.pop() || '';
  const has = (k: string) => parts.some(p => p.toLowerCase() === k);
  return {mod: has('mod') || has('ctrl') || has('cmd'), shift: has('shift'), alt: has('alt') || has('option'), key: key.toLowerCase()};
}

const keyName = (e: KeyboardEvent) => (e.key === ' ' ? 'space' : e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());

export function matches(e: KeyboardEvent, spec: string | undefined) {
  if (!spec) return false;
  const c = parse(spec);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  // "?" already implies Shift on most layouts, so Shift is not checked for symbols.
  const symbol = c.key.length === 1 && !/[a-z0-9]/.test(c.key);
  return mod === c.mod && e.altKey === c.alt && (symbol || e.shiftKey === c.shift) && (keyName(e) === c.key || e.code.toLowerCase() === `key${c.key}`);
}

// "Mod+Shift+F" → "Ctrl+Shift+F" or "⌘⇧F".
export function show(spec: string | undefined) {
  if (!spec) return '';
  const c = parse(spec);
  const key = c.key === 'enter' ? (isMac ? '↵' : 'Enter') : c.key.length === 1 ? c.key.toUpperCase() : c.key[0].toUpperCase() + c.key.slice(1);
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key); // "?" already means Shift
  if (isMac) return `${c.mod ? '⌘' : ''}${c.alt ? '⌥' : ''}${c.shift && !symbol ? '⇧' : ''}${key}`;
  return [c.mod && 'Ctrl', c.alt && 'Alt', c.shift && !symbol && 'Shift', key].filter(Boolean).join('+');
}

// Turns a key event into a spec, for recording a new shortcut in Settings. Null for lone modifier keys.
export function record(e: KeyboardEvent) {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  const parts = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

// Whether a key press happened while typing in a field (where single-key shortcuts must not fire).
export const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
};
