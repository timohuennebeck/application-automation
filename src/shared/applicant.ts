import { DocumentLanguage, TemplateKind } from './enums.ts';

/* Who the documents belong to, in the form a filename can carry. Everything
   Kepler produces and everything uploaded into a slot is named
   `<Vorname>_<Nachname>_<Anschreiben|Lebenslauf>` — recruiters download the
   PDF into a folder full of other people's "Lebenslauf.pdf", so the file must
   say whose it is on its own. Underscores rather than spaces, so the name
   survives ATS uploads and mail links without turning into %20s. */
const APPLICANT_FILE_STEM = 'Timo_Huennebeck';

/* The same person as they sign a mail — the follow-up drafts close with this.
   Kept next to the stem so the two spellings cannot drift apart. */
export const APPLICANT_NAME = 'Timo Hünnebeck';

/* The address the documents carry. It does not read like the name, which is
   why the validation pass kept reporting it: an address and a name that do not
   match is exactly the kind of thing that check is for. It is stated here so
   the check knows this one is right and says nothing about it. */
export const APPLICANT_EMAIL = 'jantimohuennebeck@gmail.com';

/* What each document is called, by language: a German recruiter downloads a
   "Lebenslauf", an English one a "CV" — the name is the first thing they see
   of the document, so it speaks the application's language. Keyed by template
   slot; the two slots and the two languages give the four names. */
export const DOCUMENT_STEMS: Record<DocumentLanguage, Record<TemplateKind, string>> = {
  [DocumentLanguage.DE]: {
    [TemplateKind.LEBENSLAUF]: `${APPLICANT_FILE_STEM}_Lebenslauf`,
    [TemplateKind.ANSCHREIBEN]: `${APPLICANT_FILE_STEM}_Anschreiben`,
  },
  [DocumentLanguage.EN]: {
    [TemplateKind.LEBENSLAUF]: `${APPLICANT_FILE_STEM}_CV`,
    [TemplateKind.ANSCHREIBEN]: `${APPLICANT_FILE_STEM}_Cover_Letter`,
  },
};
