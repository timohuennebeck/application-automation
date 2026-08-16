import { contextBridge, ipcRenderer } from 'electron';
import { DB_CHANNELS } from './db/channels.ts';
import type {
  AgentEvent,
  AgentStartResult,
  AskRequest,
  AskResult,
  VariantsRequest,
  VariantsResult,
} from '../src/shared/agent.ts';
import type { AttachmentInput, DbApi } from '../src/shared/db-types.ts';
import type { DocumentUpload, ProfileDocumentInfo, TemplateVersion } from '../src/shared/domain.ts';
import type { DocumentKind, TemplateKind } from '../src/shared/enums.ts';

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

/* Derived from DB_CHANNELS name-for-name ('db:group.method' → db.group.method,
   'db:load' → db.load), so a new channel can never be forgotten here; DbApi is
   the shape the renderer sees and keeps both sides honest. */
const db = {} as Record<string, unknown>;
for (const channel of Object.keys(DB_CHANNELS)) {
  const [group, method] = channel.slice('db:'.length).split('.');
  if (!method) db[group] = invoke(channel);
  else ((db[group] ??= {}) as Record<string, unknown>)[method] = invoke(channel);
}
const dbApi = db as unknown as DbApi;

/* The only surface the renderer gets. */
const api = {
  platform: process.platform,
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.send('theme:set', theme),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  db: dbApi,
  documents: {
    /* Native picker; null when the dialog was cancelled. */
    pick: (title: string, type: 'docx' | 'html'): Promise<string | null> =>
      ipcRenderer.invoke('documents:pick', title, type),
    /* Copies the picked HTML into userData and renders the PDF beside it,
       resolving to both stored paths. */
    copy: (applicationId: string, kind: DocumentKind, sourcePath: string): Promise<DocumentUpload> =>
      ipcRenderer.invoke('documents:copy', applicationId, kind, sourcePath),
    /* Sizes in bytes, index-aligned with the paths; null where the file is gone. */
    sizes: (filePaths: string[]): Promise<(number | null)[]> =>
      ipcRenderer.invoke('documents:sizes', filePaths),
    /* Hands the file to the OS; resolves to '' on success, else the reason. */
    open: (filePath: string): Promise<string> => ipcRenderer.invoke('documents:open', filePath),
    /* The stored HTML, for the letter editor. Rejects for a path outside the
       documents folder or a file that is gone. */
    read: (filePath: string): Promise<string> => ipcRenderer.invoke('documents:read', filePath),
    /* Writes an edited document back and re-renders the PDF beside it. The
       caller still has to store the paths through db.documents.setFile. */
    save: (applicationId: string, kind: DocumentKind, html: string): Promise<DocumentUpload> =>
      ipcRenderer.invoke('documents:save', applicationId, kind, html),
  },
  /* Files attached to comments. Picking only stages sources in the renderer;
     copy() puts the bytes into userData at send time and resolves to what
     db.comments.add stores. */
  attachments: {
    /* Multi-select, any file type; null when the dialog was cancelled. */
    pick: (title: string): Promise<{ path: string; name: string; size: number }[] | null> =>
      ipcRenderer.invoke('attachments:pick', title),
    copy: (applicationId: string, sourcePaths: string[]): Promise<AttachmentInput[]> =>
      ipcRenderer.invoke('attachments:copy', applicationId, sourcePaths),
    /* Opens a still-staged source file with the OS; '' on success, else the
       reason. Only paths returned by pick() are accepted. */
    openSource: (sourcePath: string): Promise<string> =>
      ipcRenderer.invoke('attachments:openSource', sourcePath),
  },
  /* Kepler. Starting is request/response; progress arrives as agent:event
     pushes — the run and step rows as they now stand in the database. */
  agent: {
    start: (applicationId: string): Promise<AgentStartResult> =>
      ipcRenderer.invoke('agent:start', applicationId),
    /* Rewinds the failed step of the latest run and queues it again. */
    retry: (applicationId: string): Promise<AgentStartResult> =>
      ipcRenderer.invoke('agent:retry', applicationId),
    /* Halts the active run at its current step; retry resumes from there. */
    stop: (applicationId: string): Promise<AgentStartResult> =>
      ipcRenderer.invoke('agent:stop', applicationId),
    /* Other ways to say one marked passage of a finished letter. Outside the
       run queue — nothing is written, the suggestions just come back. */
    variants: (req: VariantsRequest): Promise<VariantsResult> => ipcRenderer.invoke('agent:variants', req),
    /* Without a callId every rewrite the card has in the air goes; with one,
       just that passage. The editor uses both — the square beside a passage,
       and the teardown when the letter closes, so nothing keeps running for an
       answer nobody is waiting for. */
    variantsStop: (applicationId: string, callId?: string): Promise<void> =>
      ipcRenderer.invoke('agent:variantsStop', applicationId, callId),
    /* Answers a comment that addressed Kepler. The reply is written into the
       thread on the main side and comes back as that comment row. */
    ask: (req: AskRequest): Promise<AskResult> => ipcRenderer.invoke('agent:ask', req),
    /* Subscribes to run/step updates; returns the unsubscribe. */
    onEvent: (cb: (e: AgentEvent) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, event: AgentEvent) => cb(event);
      ipcRenderer.on('agent:event', handler);
      return () => {
        ipcRenderer.removeListener('agent:event', handler);
      };
    },
  },
  /* The profile-wide templates, as Fassungen per slot. There is no database
     behind these — the files on disk are the state, so every call reads fresh. */
  templates: {
    list: (): Promise<Record<TemplateKind, TemplateVersion[]>> => ipcRenderer.invoke('templates:list'),
    /* Copies a picked file in as a new Fassung under the next free name. */
    add: (kind: TemplateKind, sourcePath: string): Promise<TemplateVersion> =>
      ipcRenderer.invoke('templates:add', kind, sourcePath),
    /* Swaps the file of an existing Fassung. */
    replace: (kind: TemplateKind, label: string, sourcePath: string): Promise<TemplateVersion> =>
      ipcRenderer.invoke('templates:replace', kind, label, sourcePath),
    /* Marks the Fassung Kepler uses. */
    select: (kind: TemplateKind, label: string): Promise<void> =>
      ipcRenderer.invoke('templates:select', kind, label),
    rename: (kind: TemplateKind, from: string, to: string): Promise<TemplateVersion> =>
      ipcRenderer.invoke('templates:rename', kind, from, to),
    /* Refused for the selected Fassung. */
    remove: (kind: TemplateKind, label: string): Promise<void> =>
      ipcRenderer.invoke('templates:remove', kind, label),
    /* Hands a Fassung's file to the OS — the selected one when no label is
       given; '' on success, else the reason. */
    open: (kind: TemplateKind, label?: string): Promise<string> =>
      ipcRenderer.invoke('templates:open', kind, label),
    /* Renders the Fassung to PDF (once per change), hands that to the OS and
       resolves to the Fassung with its PDF size; rejects with the reason. */
    openPdf: (kind: TemplateKind, label: string): Promise<TemplateVersion> =>
      ipcRenderer.invoke('templates:openPdf', kind, label),
  },
  /* Further profile documents (Immatrikulationsbescheinigung, Zeugnisse, …).
     Like the templates there is no database — the folder listing is the state
     and a file's name is its id. */
  profileDocuments: {
    list: (): Promise<ProfileDocumentInfo[]> => ipcRenderer.invoke('profileDocuments:list'),
    /* Native multi-select picker; copies the picks straight in and resolves to
       what landed, or null when the dialog was cancelled. */
    add: (title: string): Promise<ProfileDocumentInfo[] | null> =>
      ipcRenderer.invoke('profileDocuments:add', title),
    /* Hands the file to the OS; '' on success, else the reason. */
    open: (name: string): Promise<string> => ipcRenderer.invoke('profileDocuments:open', name),
    remove: (name: string): Promise<void> => ipcRenderer.invoke('profileDocuments:remove', name),
  },
};

contextBridge.exposeInMainWorld('desktop', api);

export type DesktopApi = typeof api;
