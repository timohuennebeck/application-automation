/* The German prompts behind every LLM step. Inputs ride in tagged blocks
   (<anzeige>, <vorlage>, <profil>) so listing text can never read as
   instructions; the output shape is enforced separately by the JSON Schemas
   in schemas.ts. */
import type { Extraction } from './schemas.ts';

/* Listings are pages, not books — everything past this is boilerplate, and
   the calls stay affordable. */
const MAX_LISTING = 30_000;

/* Embedded content may not close the tag it is wrapped in — a listing that
   contains a literal </anzeige> would otherwise break out of its block. */
function sealed(text: string): string {
  return text.replace(/<\/(anzeige|vorlage|profil)>/gi, '');
}

export function clipListing(text: string): string {
  return sealed(text.length > MAX_LISTING ? text.slice(0, MAX_LISTING) : text);
}

export function extractionPrompt(listing: string): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Unten steht der Text einer Stellenanzeige.
Extrahiere die Angaben für die Bewerbungskarte. Antworte auf Deutsch.

Regeln:
- role: die Berufsbezeichnung der ausgeschriebenen Stelle, ohne Zusätze wie "(m/w/d)".
- summary: ein bis zwei Sätze, was die Stelle ist und was das Unternehmen macht.
- company: nur was die Anzeige hergibt; nichts erfinden. homepage ist die Unternehmens-Website als vollständige URL, null wenn nicht genannt.
- standort: Stadt (z. B. "Berlin"), null wenn unklar oder nur remote.
- gehalt: die genannte Spanne, kompakt in ganzen Tausendern (z. B. "70–85k €" — niemals Dezimalzahlen wie "87.7"), null wenn keine genannt ist.
- erfahrung: geforderte Berufserfahrung in Jahren, eingeordnet in die vorgegebenen Stufen.
- people: alle in der Anzeige namentlich genannten Ansprechpersonen (Recruiter, Hiring Manager) mit dem, was dasteht.
- Unbekanntes ist null, niemals ein Platzhalter.

<anzeige>
${clipListing(listing)}
</anzeige>`;
}

export function contactPrompt(company: string, website: string | null, role: string): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Für eine Bewerbung als "${role}" bei ${company}${website ? ` (${website})` : ''} nennt die Stellenanzeige keine Ansprechperson.

Suche im Web nach einer passenden realen Ansprechperson für diese Bewerbung: Recruiter, Talent Acquisition oder die zuständige Führungskraft bei ${company}. Nutze öffentliche Quellen (Team-Seiten, Impressum, LinkedIn-Profile in Suchergebnissen).

Regeln:
- Nur eine Person, und nur wenn du sie einer öffentlichen Quelle klar zuordnen kannst.
- role ist die Funktion der Person, linkedin die Profil-URL falls gefunden.
- Erfinde nichts. Findest du niemanden Belastbares, ist person null.`;
}

export interface DocumentInput {
  template: string;
  listing: string;
  extraction: Extraction;
  profileFacts: string[];
  company: string;
  role: string;
}

const documentContext = (input: DocumentInput) => `<anzeige>
${clipListing(input.listing)}
</anzeige>

<vorlage>
${sealed(input.template)}
</vorlage>

<profil>
${sealed(input.profileFacts.length ? input.profileFacts.map((f) => '- ' + f).join('\n') : '(keine Angaben)')}
</profil>`;

export function cvPrompt(input: DocumentInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Erstelle aus der hochgeladenen Lebenslauf-Vorlage einen auf diese Stelle zugeschnittenen Lebenslauf: "${input.role}" bei ${input.company}.

Regeln:
- Übernimm Layout, Stile und Struktur der Vorlage unverändert; passe nur Inhalte an.
- Alle Fakten (Stationen, Daten, Abschlüsse, Kontaktdaten) kommen aus der Vorlage — erfinde keine Erfahrung dazu.
- Schärfe Formulierungen und Reihenfolge auf die Anforderungen der Anzeige; relevante Fähigkeiten nach vorn.
- Die Profil-Angaben unten dürfen einfließen, wo sie passen.
- Sprache: die Sprache der Vorlage.
- html ist das komplette Dokument, beginnend mit <!doctype html>.

${documentContext(input)}`;
}

export function letterPrompt(input: DocumentInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Erstelle aus der hochgeladenen Anschreiben-Vorlage ein Anschreiben für diese Stelle: "${input.role}" bei ${input.company}.

Regeln:
- Übernimm Layout, Stile und Briefkopf der Vorlage; ersetze den Text durch ein auf die Anzeige zugeschnittenes Anschreiben.
- Platzhalter in doppelten geschweiften Klammern ({{...}}) füllst du aus; ein Platzhalter mit OPTIONAL entfällt ersatzlos, wenn nichts passt. Kein Platzhalter bleibt im Ergebnis stehen.
- Beziehe dich konkret auf die Stelle und das Unternehmen; kein generischer Text.
- Die Profil-Angaben unten machen den Brief persönlich — nutze ein bis zwei davon, wo sie natürlich passen.
- Erfinde keine Fakten, die weder Vorlage noch Profil hergeben.
- Sprache: die Sprache der Vorlage.
- html ist das komplette Dokument, beginnend mit <!doctype html>.

${documentContext(input)}`;
}

/* The checks read what the document SAYS, not how it is styled — a raw head
   window would be all stylesheet on a real template. Strip style/script and
   tags, then take the front of the visible text. */
const EXCERPT = 3_000;

export function documentExcerpt(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EXCERPT);
}

export function checksPrompt(extraction: Extraction, cvHtml: string, letterHtml: string): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Prüfe die erfassten Daten und die Textauszüge der zwei generierten Dokumente auf offensichtliche Fehler.

Prüfe:
- Passen Rolle und Unternehmen in den Dokumenten zu den erfassten Daten?
- Datumsformate (DD.MM.YYYY), Gehaltsformat, plausible URLs und E-Mail-Adressen?
- Widersprüche zwischen den Angaben?

issues: höchstens die drei wichtigsten echten Probleme, je EIN kurzer Satz (unter 15 Wörter), ohne Herleitung oder Zitate; hebe den Kern jedes Hinweises mit **fett** hervor (z. B. "**E-Mail-Adresse** passt nicht zum Namen."). Leer, wenn alles stimmig ist.

<daten>
${JSON.stringify(extraction, null, 1)}
</daten>

<lebenslauf>
${documentExcerpt(cvHtml)}
</lebenslauf>

<anschreiben>
${documentExcerpt(letterHtml)}
</anschreiben>`;
}
