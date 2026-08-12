import type { DesktopApi } from '../electron/preload';

declare global {
  interface Window {
    /* Injected by electron/preload.ts. Absent when the renderer runs in a
       plain browser tab (e.g. `vite` without Electron). */
    desktop?: DesktopApi;
  }
}

export {};
