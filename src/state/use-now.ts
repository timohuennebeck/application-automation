import { useEffect, useState } from 'react';

/* Re-renders the caller once a second so an elapsed timer keeps counting.

   The store used to do this for everyone: a `tick` counter on AppState,
   incremented by an interval, read by nothing. Because `st` is part of the
   context value, that re-rendered every component calling useApp() once a
   second — the whole board, the sidebar, every open dialog — to move two
   timers. This keeps the clock next to the two components that show one, and
   stops it when there is nothing to count. */
export function useNow(active: boolean): void {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [active]);
}
