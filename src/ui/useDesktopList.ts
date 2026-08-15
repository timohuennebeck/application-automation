/* One listing from the desktop bridge on mount, guarded against applying
   after unmount — the fetch-on-open pattern the profile dialog and the run
   panel used to hand-roll three times. Returns the state pair so callers
   that patch the list after writes (add, rename, remove) can. */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export function useDesktopList<T>(
  fetch: () => Promise<T> | undefined,
  onError: (msg: string) => void,
): [T | null, Dispatch<SetStateAction<T | null>>] {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    fetch()
      ?.then((d) => {
        if (live) setData(d);
      })
      .catch((err) => {
        if (live) onError(String(err));
      });
    return () => {
      live = false;
    };
    /* On mount only — the callers pass inline closures. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [data, setData];
}
