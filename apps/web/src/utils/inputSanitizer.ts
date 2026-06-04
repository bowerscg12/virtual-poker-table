/**
 * Global text-input sanitizer.
 *
 * Restricts every text field in the app to "regular keyboard" characters —
 * printable ASCII (0x20–0x7E: letters, digits, space, and standard symbols).
 * Emoji, accented letters, smart quotes, and other non-keyboard/control
 * characters are blocked. Installed once at startup so it also covers any
 * inputs added in the future, without touching each component.
 */

// Single character outside printable ASCII — used with String.test (non-global).
const DISALLOWED = /[^\x20-\x7E]/;
// Same set, global — used for replace()/match() to strip every occurrence.
const DISALLOWED_GLOBAL = /[^\x20-\x7E]/g;

// Input types that never carry free-form text — skip them entirely.
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit',
  'reset', 'image', 'number', 'date', 'datetime-local', 'month', 'time', 'week',
]);

function isTextEntry(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return false;
}

/**
 * Force a React-controlled input/textarea to a new value and notify React.
 * Uses the prototype's native value setter so React's change tracking fires.
 */
function setSanitizedValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  // Re-dispatch so React's onChange runs with the cleaned value. The cleaned value
  // contains no disallowed characters, so the listener below early-returns — no loop.
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

let installed = false;

export function installGlobalInputSanitizer(): void {
  // Idempotent — guard against double registration (e.g. dev HMR re-running entry).
  if (installed) return;
  installed = true;

  // 1) Primary guard: block disallowed characters before they enter the field
  //    (typing, paste, drag-and-drop, emoji picker). Re-inserting the cleaned text
  //    keeps the valid part of a mixed paste, plus caret position and undo history.
  document.addEventListener(
    'beforeinput',
    (e) => {
      const ie = e as InputEvent;
      if (!isTextEntry(ie.target)) return;
      if (ie.data && DISALLOWED.test(ie.data)) {
        e.preventDefault();
        const cleaned = ie.data.replace(DISALLOWED_GLOBAL, '');
        if (cleaned) document.execCommand('insertText', false, cleaned);
      }
    },
    true
  );

  // 2) Fallback: strip anything that slipped past (e.g. IME composition commit or
  //    programmatic edits), keeping the React-controlled value in sync and the caret
  //    roughly in place.
  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!isTextEntry(el)) return;
      const { value } = el;
      if (!DISALLOWED.test(value)) return;
      const caret = el.selectionStart ?? value.length;
      const removedBeforeCaret = (value.slice(0, caret).match(DISALLOWED_GLOBAL) ?? []).length;
      setSanitizedValue(el, value.replace(DISALLOWED_GLOBAL, ''));
      const newCaret = caret - removedBeforeCaret;
      try {
        el.setSelectionRange(newCaret, newCaret);
      } catch {
        /* some input types don't support selection — ignore */
      }
    },
    true
  );
}
