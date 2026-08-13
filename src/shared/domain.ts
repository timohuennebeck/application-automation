/* Domain constants and types shared by the Electron main process (seed, repo,
   files) and the renderer. The canonical round titles decide whether clearing
   an interview resets the row or removes it, so every side has to agree on the
   same four. */

export const CANONICAL_ROUNDS: string[] = ['Screening', 'Runde 1', 'Runde 2', 'Finales Gespräch'];

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
