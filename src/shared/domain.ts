/* Domain constants and types shared by the Electron main process (seed, repo,
   files) and the renderer. */

/* The preset titles the create-interview dialog offers, mirroring the
   interview stages of the kanban board. */
export const CANONICAL_ROUNDS: string[] = ['Screening', 'Interview', '2. Interview', 'Finales Gespräch'];

/* The comment Kepler leaves on every freshly created card. */
export const DEFAULT_COMMENT =
  'Karte aus der Stellenanzeige angelegt. Anschreiben und Lebenslauf liegen im Reiter Bewerbungsunterlagen.';

/* The default follow-up cadence as [days after the anchor, label]. A card
   created today counts from today (repo); a seeded card counts from the seed's
   frozen anchor — same slots either way. */
export const DEFAULT_FOLLOWUPS: [number, string][] = [
  [0, 'Follow up zur Bewerbung'],
  [9, 'Erneutes Follow up'],
  [25, 'Letztes Follow up'],
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
  size: number;
  /* Local calendar day the file was last written, as YYYY-MM-DD. */
  day: string;
}
