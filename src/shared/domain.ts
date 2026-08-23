/* Domain constants and types shared by the Electron main process (seed, repo,
   files) and the renderer. */
import type { DocumentLanguage, TemplateKind } from './enums.ts';

/* The preset titles the create-interview dialog offers, mirroring the
   interview stages of the kanban board. */
export const CANONICAL_ROUNDS: string[] = ['Screening', 'Interview', '2. Interview', 'Finales Gespräch'];

/* The company a card gets when none is known — created without one, or
   emptied in the sidebar. A card always points at some company row. */
export const UNKNOWN_COMPANY = 'Unbekanntes Unternehmen';
/* Likewise the role of a card created without one, or emptied in the sidebar. */
export const UNKNOWN_ROLE = 'Neue Bewerbung';

/* The comment Kepler leaves on every freshly created card. */
export const DEFAULT_COMMENT = 'Karte angelegt – Bewerbung steht noch aus.';

/* The default follow-up cadence as [days after the anchor, label]. A card
   created today counts from today (repo); a seeded card counts from the seed's
   frozen anchor — same slots either way. Nothing is due on day 0: an
   application needs a week before a nudge is anything but pushy. */
export const DEFAULT_FOLLOWUPS: [number, string][] = [
  [7, 'Follow up zur Bewerbung'],
  [14, 'Erneutes Follow up'],
  [30, 'Letztes Follow up'],
];

/* What a document upload left behind: the stored HTML and the PDF rendered from
   it. The two steps are reported separately because the upload can succeed
   while the export does not — the HTML is kept either way, and pdfError is what
   the card has to say about the missing PDF. */
export interface DocumentUpload {
  filePath: string;
  pdfPath: string | null;
  pdfError: string | null;
}

/* What the profile dialog knows about a stored template. Read from the file
   itself on every call — there is no row that could disagree with it. */
export interface TemplateInfo {
  /* The file's name on disk — what every chip and caption shows. A template is
     renamed to the applicant's document name on upload; a profile document
     keeps the name it was picked under. */
  name: string;
  size: number;
  /* Local calendar day the file was last written, as YYYY-MM-DD. */
  day: string;
}

/* One Fassung of a template slot: its file plus the label it is filed under
   (the directory name) and whether it is the one Kepler uses. */
export interface TemplateVersion extends TemplateInfo {
  label: string;
  selected: boolean;
  /* Size of the PDF rendered beside the HTML, null until it was rendered once. */
  pdfSize: number | null;
}

/* Every slot's Fassungen by language side, as templates:list reports them —
   the shape the profile dialog and the run panel's doc chips both consume. */
export type TemplateSlots = Record<TemplateKind, Record<DocumentLanguage, TemplateVersion[]>>;

/* A file in the profile's document folder — Immatrikulationsbescheinigung,
   Zeugnisse, whatever should be kept in one place. Same shape as a template,
   and read from disk in the same way; the name doubles as its id. */
export type ProfileDocumentInfo = TemplateInfo;
