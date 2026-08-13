/* Maps every repo function onto a db:* IPC channel, 1:1. The channel names
   are the contract with preload.ts / DbApi — change them in both places. */
import { ipcMain } from 'electron';
import type { Repo } from './repo.ts';

export const DB_CHANNELS = {
  'db:load': 'load',
  'db:applications.create': 'createApplication',
  'db:applications.update': 'updateApplication',
  'db:applications.move': 'moveCard',
  'db:applications.delete': 'deleteApplication',
  'db:applications.relinkCompany': 'relinkCompany',
  'db:companies.update': 'updateCompany',
  'db:facts.upsert': 'upsertFact',
  'db:facts.delete': 'deleteFact',
  'db:comments.add': 'addComment',
  'db:comments.update': 'updateComment',
  'db:comments.delete': 'deleteComment',
  'db:rounds.set': 'setRounds',
  'db:roundNotes.add': 'addRoundNote',
  'db:people.create': 'createPerson',
  'db:people.update': 'updatePerson',
  'db:people.delete': 'deletePerson',
  'db:applicationPeople.set': 'setApplicationPeople',
  'db:followups.setDue': 'setFollowupDue',
  'db:followups.setCompleted': 'setFollowupCompleted',
  'db:followups.saveEmail': 'saveFollowupEmail',
  'db:documents.setFile': 'setDocumentFile',
  'db:activities.add': 'addActivity',
  'db:profileFacts.add': 'addProfileFact',
  'db:profileFacts.update': 'updateProfileFact',
  'db:profileFacts.delete': 'deleteProfileFact',
  'db:profileFacts.reorder': 'reorderProfileFacts',
} as const satisfies Record<string, keyof Repo>;

/* Side effects that outlive the database row. Deleting an application cascades
   its child rows, but nothing in SQL clears the files on disk — and this is the
   one layer that knows about both. */
export interface DbIpcHooks {
  afterDeleteApplication?: (applicationId: string) => void;
}

export function registerDbIpc(repo: Repo, hooks: DbIpcHooks = {}): void {
  for (const [channel, method] of Object.entries(DB_CHANNELS)) {
    const fn = repo[method] as (...args: unknown[]) => unknown;
    ipcMain.handle(channel, (_e, ...args: unknown[]) => {
      const out = fn(...args);
      if (method === 'deleteApplication') hooks.afterDeleteApplication?.(args[0] as string);
      return out;
    });
  }
}
