/* Maps every repo function onto a db:* IPC channel, 1:1 — the contract
   between registerDbIpc (main) and the preload bridge, which derives its
   `db` object from these names ('db:group.method' → db.group.method). Kept
   free of electron imports so the preload bundle can pull it in. */
import type { Repo } from './repo.ts';

export const DB_CHANNELS = {
  'db:load': 'load',
  'db:applications.create': 'createApplication',
  'db:applications.update': 'updateApplication',
  'db:applications.move': 'moveCard',
  'db:applications.delete': 'deleteApplication',
  'db:applications.relinkCompany': 'relinkCompany',
  'db:companies.update': 'updateCompany',
  'db:companies.delete': 'deleteCompany',
  'db:locations.delete': 'deleteLocation',
  'db:roles.delete': 'deleteRole',
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
