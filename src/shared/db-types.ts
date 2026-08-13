/* Row types for every table in bewerbungen.db, shared between the Electron
   main process (schema, seed, repo) and the renderer (snapshot state).
   Mirrors docs/superpowers/specs/2026-08-12-sqlite-persistence-design.md.
   The closed value sets these rows carry are the enums in ./enums.ts. */

import type {
    Author,
    DocumentKind,
    FactKind,
    Interest,
    LinkKind,
    RoundState,
} from "./enums.ts";

export interface StageRow {
    id: string;
    title: string;
    position: number;
}

export interface CompanyRow {
    id: number;
    name: string;
    sector: string | null;
    headcount: string | null;
    website: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface ApplicationRow {
    id: string;
    role: string;
    company_id: number;
    interest: Interest;
    channel: string | null;
    stage_id: string;
    stage_position: number;
    summary: string | null;
    applied_at: string | null;
    applied_via: string | null;
    last_contact_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface FactRow {
    id: number;
    application_id: string;
    label: string;
    value: string;
    kind: FactKind | null;
    position: number;
}

export interface PersonRow {
    id: number;
    name: string;
    role: string | null;
    initials: string | null;
    email: string | null;
    phone: string | null;
    linkedin: string | null;
    color: string;
    created_at: string;
    updated_at: string;
}

export interface ApplicationPersonRow {
    application_id: string;
    person_id: number;
    kind: LinkKind;
    position: number;
}

export interface CommentRow {
    id: number;
    application_id: string;
    author: Author;
    text: string;
    created_at: string;
    edited_at: string | null;
}

export interface RoundRow {
    id: number;
    application_id: string;
    position: number;
    state: RoundState;
    title: string;
    /* Local wall-clock appointment: date + optional start/end range. */
    scheduled_date: string | null;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
    link: string | null;
}

export interface RoundPersonRow {
    round_id: number;
    person_id: number;
    position: number;
}

export interface RoundNoteRow {
    id: number;
    round_id: number;
    author: Author;
    text: string;
    created_at: string;
}

export interface FollowupRow {
    id: number;
    application_id: string;
    label: string;
    due_at: string;
    position: number;
    /* Drafts are generated once and stored; never regenerated on open. */
    email_subject: string | null;
    email_text: string | null;
    generated_at: string | null;
}

export interface DocumentRow {
    id: number;
    application_id: string;
    kind: DocumentKind;
    title: string;
    format: string;
    /* Relative to userData/documents/<application_id>/; NULL until a real file exists. */
    file_path: string | null;
    created_at: string;
    updated_at: string;
}

export interface ActivityRow {
    id: number;
    application_id: string;
    author: Author;
    text: string;
    created_at: string;
}

/* Input shape for the full-list round replace (db:rounds.set). */
export interface RoundInput {
    id?: number;
    state: RoundState;
    title: string;
    scheduled_date: string | null;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
    link: string | null;
    people: number[];
}

export interface CreateApplicationResult {
    application: ApplicationRow;
    company: CompanyRow;
    rounds: RoundRow[];
    followups: FollowupRow[];
    documents: DocumentRow[];
    comments: CommentRow[];
    /* Links for the people picked in the dialog — contacts and, mirrored onto
       them, the follow-up email's recipients. */
    people: ApplicationPersonRow[];
    /* Stage siblings whose position shifted to make room. */
    applications: ApplicationRow[];
}

/* stage_id is not patchable — stage changes go through applications.move,
   which keeps stage_position contiguous. */
export type ApplicationPatch = Partial<
    Pick<
        ApplicationRow,
        | "role"
        | "interest"
        | "channel"
        | "summary"
        | "applied_at"
        | "applied_via"
        | "last_contact_at"
    >
>;
export type CompanyPatch = Partial<
    Pick<
        CompanyRow,
        | "name"
        | "sector"
        | "headcount"
        | "website"
        | "email"
        | "phone"
        | "notes"
    >
>;
export type PersonPatch = Partial<
    Pick<
        PersonRow,
        "name" | "role" | "email" | "phone" | "linkedin" | "initials"
    >
>;
export interface PersonInput {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
}

/* The renderer-facing async API exposed as window.desktop.db. Preload maps
   each method onto its db:* IPC channel; the main side is electron/db/repo.ts. */
export interface DbApi {
    load(): Promise<DbSnapshot>;
    applications: {
        create(input: {
            role: string;
            company: string;
            channel: string | null;
            summary?: string | null;
            people?: number[];
        }): Promise<CreateApplicationResult>;
        update(id: string, patch: ApplicationPatch): Promise<ApplicationRow>;
        move(
            id: string,
            toStageId: string,
            toIndex: number,
        ): Promise<ApplicationRow[]>;
        delete(id: string): Promise<void>;
        relinkCompany(
            id: string,
            name: string,
        ): Promise<{ application: ApplicationRow; company: CompanyRow }>;
    };
    companies: {
        update(companyId: number, patch: CompanyPatch): Promise<CompanyRow>;
    };
    facts: {
        upsert(
            applicationId: string,
            label: string,
            value: string,
            kind: FactKind | null,
        ): Promise<FactRow>;
        delete(applicationId: string, label: string): Promise<void>;
    };
    comments: {
        add(
            applicationId: string,
            author: Author,
            text: string,
        ): Promise<CommentRow>;
        update(commentId: number, text: string): Promise<CommentRow>;
        delete(commentId: number): Promise<void>;
    };
    rounds: {
        set(
            applicationId: string,
            rounds: RoundInput[],
        ): Promise<{ rounds: RoundRow[]; roundPeople: RoundPersonRow[] }>;
    };
    roundNotes: {
        add(
            roundId: number,
            author: Author,
            text: string,
        ): Promise<RoundNoteRow>;
    };
    people: {
        create(input: PersonInput): Promise<PersonRow>;
        update(personId: number, patch: PersonPatch): Promise<PersonRow>;
        delete(personId: number): Promise<void>;
    };
    applicationPeople: {
        set(
            applicationId: string,
            kind: LinkKind,
            personIds: number[],
        ): Promise<ApplicationPersonRow[]>;
    };
    followups: {
        setDue(followupId: number, dueAt: string): Promise<FollowupRow>;
        saveEmail(
            followupId: number,
            subject: string,
            text: string,
        ): Promise<FollowupRow>;
    };
    activities: {
        add(
            applicationId: string,
            author: Author,
            text: string,
        ): Promise<ActivityRow>;
    };
}

/* Everything db:load returns — the renderer's entire domain state. */
export interface DbSnapshot {
    stages: StageRow[];
    companies: CompanyRow[];
    applications: ApplicationRow[];
    facts: FactRow[];
    people: PersonRow[];
    applicationPeople: ApplicationPersonRow[];
    comments: CommentRow[];
    rounds: RoundRow[];
    roundPeople: RoundPersonRow[];
    roundNotes: RoundNoteRow[];
    followups: FollowupRow[];
    documents: DocumentRow[];
    activities: ActivityRow[];
}
