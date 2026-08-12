import { contextBridge, ipcRenderer } from 'electron';

/* The only surface the renderer gets. Agent SDK calls will be added here as
   typed request/response channels once the backend lands. */
const api = {
  platform: process.platform,
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.send('theme:set', theme),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
};

contextBridge.exposeInMainWorld('desktop', api);

export type DesktopApi = typeof api;
