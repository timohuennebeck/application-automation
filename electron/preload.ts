import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent, AgentStartResult } from '../src/shared/agent.ts';
import type { AttachmentInput, DbApi } from '../src/shared/db-types.ts';
import type { DocumentUpload, ProfileDocumentInfo, TemplateVersion } from '../src/shared/domain.ts';
import type { DocumentKind, TemplateKind } from '../src/shared/enums.ts';

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

/* Mirrors electron/db/ipc.ts channel-for-channel; DbApi keeps both sides honest. */
const db: DbApi = {
  load: invoke('db:load') as DbApi['load'],
  applications: {
    create: invoke('db:applications.create'),
    update: invoke('db:applications.update'),
    move: invoke('db:applications.move'),
    delete: invoke('db:applications.delete'),
    relinkCompany: invoke('db:applications.relinkCompany'),
  } as DbApi['applications'],
  companies: {
    update: invoke('db:companies.update'),
    delete: invoke('db:companies.delete'),
  } as DbApi['companies'],
  locations: { delete: invoke('db:locations.delete') } as DbApi['locations'],
  roles: { delete: invoke('db:roles.delete') } as DbApi['roles'],
  facts: {
    upsert: invoke('db:facts.upsert'),
    delete: invoke('db:facts.delete'),
  } as DbApi['facts'],
  comments: {
    add: invoke('db:comments.add'),
    update: invoke('db:comments.update'),
    delete: invoke('db:comments.delete'),
  } as DbApi['comments'],
  rounds: { set: invoke('db:rounds.set') } as DbApi['rounds'],
  roundNotes: { add: invoke('db:roundNotes.add') } as DbApi['roundNotes'],
  people: {
    create: invoke('db:people.create'),
    update: invoke('db:people.update'),
    delete: invoke('db:people.delete'),
  } as DbApi['people'],
  applicationPeople: {
    set: invoke('db:applicationPeople.set'),
  } as DbApi['applicationPeople'],
  followups: {
    setDue: invoke('db:followups.setDue'),
    setCompleted: invoke('db:followups.setCompleted'),
    saveEmail: invoke('db:followups.saveEmail'),
  } as DbApi['followups'],
  documents: { setFile: invoke('db:documents.setFile') } as DbApi['documents'],
  activities: { add: invoke('db:activities.add') } as DbApi['activities'],
  profileFacts: {
    add: invoke('db:profileFacts.add'),
    update: invoke('db:profileFacts.update'),
    delete: invoke('db:profileFacts.delete'),
    reorder: invoke('db:profileFacts.reorder'),
  } as DbApi['profileFacts'],
};

/* The only surface the renderer gets. */
const api = {
  platform: process.platform,
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.send('theme:set', theme),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  db,
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
    /* Renders the Fassung to PDF (once per change) and hands that to the OS;
       '' on success, else the reason. */
    openPdf: (kind: TemplateKind, label: string): Promise<string> =>
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
