/* Every closed value set that is stored in the database or crosses the
   main↔renderer boundary. The member value is exactly what SQLite holds, so
   this file is the only place those literals may appear — everywhere else
   compares against the member (RoundState.DONE, LinkKind.CONTACT, …).

   These are const objects rather than `enum` declarations because both
   tsconfigs run with erasableSyntaxOnly, which rules out enum syntax. Usage is
   identical, and each name is both the value namespace and the type.

   Renderer-only value sets (dot shapes, popover variants, agent steps) live
   next to the component that owns them. */

export const Author = {
    DU: "DU",
    KEPLER: "KEPLER",
} as const;
export type Author = (typeof Author)[keyof typeof Author];

/* What the UI calls each author. The stored value is an identifier; these are
   the German names shown in comments, notes and the history. */
export const AUTHOR_LABEL: Record<Author, string> = {
    [Author.DU]: "Du",
    [Author.KEPLER]: "Kepler",
};

export const RoundState = {
    DONE: "DONE",
    NEXT: "NEXT",
    OPEN: "OPEN",
} as const;
export type RoundState = (typeof RoundState)[keyof typeof RoundState];

/* How a person is attached to an application: the card's contacts, its
   suggestion pool for interviews, or the follow-up email's recipients. */
export const LinkKind = {
    CONTACT: "CONTACT",
    POOL: "POOL",
    EMAIL: "EMAIL",
} as const;
export type LinkKind = (typeof LinkKind)[keyof typeof LinkKind];

/* How a facts row is rendered. The column stays nullable — plain text has no
   kind at all. */
export const FactKind = {
    SELECT: "SELECT",
    LINK: "LINK",
} as const;
export type FactKind = (typeof FactKind)[keyof typeof FactKind];

export const DocumentKind = {
    COVER_LETTER: "COVER_LETTER",
    LEBENSLAUF: "LEBENSLAUF",
    OTHER: "OTHER",
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

export const Interest = {
    URGENT: "URGENT",
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
    NONE: "NONE",
} as const;
export type Interest = (typeof Interest)[keyof typeof Interest];
