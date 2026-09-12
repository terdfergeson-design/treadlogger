import { useState } from "react";

/**
 * Local draft of a value that is owned elsewhere.
 *
 * Sliders need to move freely while dragged, but the authoritative value only
 * changes once the treadmill has accepted the command. This keeps a local copy
 * and re-syncs it when the owned value changes, using React's documented
 * adjust-state-during-render pattern rather than an effect — an effect would
 * render the stale draft first and then correct it.
 */
export function useDraftValue<T>(value: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  return [draft, setDraft];
}
