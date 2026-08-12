/* Maps every repo function onto a db:* IPC channel, 1:1. The channel names
   are the contract with preload.ts / DbApi — change them in both places. */
import { ipcMain } from "electron";
import type { Repo } from "./repo.ts";

export const DB_CHANNELS = {
    "db:load": (r: Repo) => r.load.bind(r),
    "db:applications.create": (r: Repo) => r.createApplication.bind(r),
    "db:applications.update": (r: Repo) => r.updateApplication.bind(r),
    "db:applications.move": (r: Repo) => r.moveCard.bind(r),
    "db:applications.delete": (r: Repo) => r.deleteApplication.bind(r),
    "db:applications.relinkCompany": (r: Repo) => r.relinkCompany.bind(r),
    "db:companies.update": (r: Repo) => r.updateCompany.bind(r),
    "db:facts.upsert": (r: Repo) => r.upsertFact.bind(r),
    "db:facts.delete": (r: Repo) => r.deleteFact.bind(r),
    "db:comments.add": (r: Repo) => r.addComment.bind(r),
    "db:comments.update": (r: Repo) => r.updateComment.bind(r),
    "db:comments.delete": (r: Repo) => r.deleteComment.bind(r),
    "db:rounds.set": (r: Repo) => r.setRounds.bind(r),
    "db:roundNotes.add": (r: Repo) => r.addRoundNote.bind(r),
    "db:people.create": (r: Repo) => r.createPerson.bind(r),
    "db:people.update": (r: Repo) => r.updatePerson.bind(r),
    "db:people.delete": (r: Repo) => r.deletePerson.bind(r),
    "db:applicationPeople.set": (r: Repo) => r.setApplicationPeople.bind(r),
    "db:followups.setDue": (r: Repo) => r.setFollowupDue.bind(r),
    "db:followups.saveEmail": (r: Repo) => r.saveFollowupEmail.bind(r),
    "db:activities.add": (r: Repo) => r.addActivity.bind(r),
} as const;

export function registerDbIpc(repo: Repo): void {
    for (const [channel, pick] of Object.entries(DB_CHANNELS)) {
        const fn = pick(repo) as (...args: unknown[]) => unknown;
        ipcMain.handle(channel, (_e, ...args: unknown[]) => fn(...args));
    }
}
