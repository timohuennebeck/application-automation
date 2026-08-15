/* What every store action needs, and the one way the store reloads the truth.
   Split out of store.tsx so the pieces the provider hands to its actions have
   a name — and so the two resync paths share one implementation. */
import { useCallback, useEffect, useRef } from 'react';
import { indexSnapshot } from './db-view';
import type { AppState, Patch } from './store-context';

export function db() {
  return window.desktop?.db;
}

/* Pulls the snapshot and applies it, deferring while the user is mid-gesture.

   The snapshot replaces domain state wholesale, so applying it during a drag
   or an open field edit visually reverts work whose write is still on its way.
   Both callers need that guard: the agent's push events and a failed optimistic
   write both end in "reload the truth", and only the first one used to have it. */
export function useResync(set: (patch: Patch) => void, stRef: { current: AppState }) {
  const timer = useRef<number | undefined>(undefined);
  /* A pending reload would otherwise land after the provider is gone. */
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return useCallback(
    function resync(): void {
      window.clearTimeout(timer.current);
      /* Debounced: several agent steps can land at once, and a failed batch
         can reject several writes together. */
      timer.current = window.setTimeout(() => {
        db()
          ?.load()
          .then((snap) => {
            if (stRef.current.dragId || stRef.current.editing) {
              resync();
              return;
            }
            set(indexSnapshot(snap));
          })
          .catch((err) => console.error('[db] resync failed', err));
      }, 150);
    },
    [set, stRef],
  );
}
