/* Who the documents belong to, in the form a filename can carry. Everything
   Kepler produces and everything uploaded into a slot is named
   `<Vorname>_<Nachname>_<Anschreiben|Lebenslauf>` — recruiters download the
   PDF into a folder full of other people's "Lebenslauf.pdf", so the file must
   say whose it is on its own. Underscores rather than spaces, so the name
   survives ATS uploads and mail links without turning into %20s. */
const APPLICANT_FILE_STEM = 'Timo_Huennebeck';

/* The German labels are used regardless of the posting's language — the two
   file names on the profile and on every card stay predictable. */
export const DOCUMENT_STEMS = {
  ANSCHREIBEN: `${APPLICANT_FILE_STEM}_Anschreiben`,
  LEBENSLAUF: `${APPLICANT_FILE_STEM}_Lebenslauf`,
} as const;
