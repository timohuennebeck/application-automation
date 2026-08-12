import { contextBridge, ipcRenderer } from "electron";
import type { DbApi } from "../src/shared/db-types.ts";

const invoke =
    (channel: string) =>
    (...args: unknown[]) =>
        ipcRenderer.invoke(channel, ...args);

/* Mirrors electron/db/ipc.ts channel-for-channel; DbApi keeps both sides honest. */
const db: DbApi = {
    load: invoke("db:load") as DbApi["load"],
    applications: {
        create: invoke("db:applications.create"),
        update: invoke("db:applications.update"),
        move: invoke("db:applications.move"),
        delete: invoke("db:applications.delete"),
        relinkCompany: invoke("db:applications.relinkCompany"),
    } as DbApi["applications"],
    companies: { update: invoke("db:companies.update") } as DbApi["companies"],
    facts: {
        upsert: invoke("db:facts.upsert"),
        delete: invoke("db:facts.delete"),
    } as DbApi["facts"],
    comments: {
        add: invoke("db:comments.add"),
        update: invoke("db:comments.update"),
        delete: invoke("db:comments.delete"),
    } as DbApi["comments"],
    rounds: { set: invoke("db:rounds.set") } as DbApi["rounds"],
    roundNotes: { add: invoke("db:roundNotes.add") } as DbApi["roundNotes"],
    people: {
        create: invoke("db:people.create"),
        update: invoke("db:people.update"),
        delete: invoke("db:people.delete"),
    } as DbApi["people"],
    applicationPeople: {
        set: invoke("db:applicationPeople.set"),
    } as DbApi["applicationPeople"],
    followups: {
        setDue: invoke("db:followups.setDue"),
        saveEmail: invoke("db:followups.saveEmail"),
    } as DbApi["followups"],
    activities: { add: invoke("db:activities.add") } as DbApi["activities"],
};

/* The only surface the renderer gets. Agent SDK calls will be added here as
   typed request/response channels once the backend lands. */
const api = {
    platform: process.platform,
    setTheme: (theme: "light" | "dark") => ipcRenderer.send("theme:set", theme),
    openExternal: (url: string) =>
        ipcRenderer.invoke("shell:openExternal", url),
    db,
};

contextBridge.exposeInMainWorld("desktop", api);

export type DesktopApi = typeof api;
