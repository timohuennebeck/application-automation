/* The German prompts behind every LLM step. Inputs ride in tagged blocks
   (<anzeige>, <vorlage>, <profil>, <kontakte>) so listing text can never read as
   instructions; the output shape is enforced separately by the JSON Schemas
   in schemas.ts. */
import type { Extraction } from './schemas.ts';

/* Listings are pages, not books — everything past this is boilerplate, and
   the calls stay affordable. */
const MAX_LISTING = 30_000;

/* Embedded content may not close the tag it is wrapped in — a listing that
   contains a literal </anzeige> would otherwise break out of its block. */
function sealed(text: string): string {
  return text.replace(/<\/(anzeige|vorlage|profil|kontakte|lebenslauf)>/gi, '');
}

function clipListing(text: string): string {
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
  /* Contacts linked to the card — from the listing or researched by the
     contact step — as "Name (Rolle)" lines. The letter is addressed to the
     first one; nothing else in the app knows a person the listing did not
     name. */
  contacts: string[];
  /* HTML of the selected CV Fassung — the applicant's facts live there, so
     the letter reads them instead of a second copy that would drift. Null
     when no CV is uploaded. */
  cv: string | null;
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

/* What no document holds: the terms of the move itself. Everything else
   about the applicant comes from the Lebenslauf and the Profil-Angaben. */
const TERMS = `Kündigungsfrist: 3 Monate zum Monatsende. Frühester Eintritt: nach Absprache.
Gehaltsvorstellung (nur wenn die Anzeige sie ausdrücklich verlangt): 75.000 EUR bei Mid-Level-Titeln oder kleineren Unternehmen, 80.000 EUR bei Senior-Rollen in Produktfirmen, 85.000 EUR bei Senior-Rollen in Scale-ups, Konzernen oder Fintech oder wenn die Anzeige selbst eine höhere Spanne nennt. Immer eine runde Zahl auf .000, brutto p.a.`;

/* The placeholder glossary is written for the T-format Fassung; a Fassung
   with other names still works through the "sinngemäß" rule at the end. */
const PLACEHOLDER_GLOSSARY = `Briefkopf und Adressat
- {{CANDIDATE_HEADER_ROLE}}: Unterzeile unter dem Namen des Bewerbers, auf die Ausrichtung der Stelle zugeschnitten (z. B. "Senior Frontend Developer · React, Next.js, Expo" oder "Software Developer · TypeScript, Cloud & AI Workflows").
- {{COMPANY_NAME}}: offizieller Name des Unternehmens (z. B. "Personio SE", "BMW Group").
- {{RECIPIENT_NAME}}: Ansprechperson mit Anrede (z. B. "Frau Dr. Julia Weber", "Herr Thomas Müller") — die erste Person aus <kontakte>, sonst die in der Anzeige genannte; gibt es keine: "Engineering Hiring Team".
- {{COMPANY_STREET}}: Straße und Hausnummer, nur wenn die Anzeige sie nennt; sonst entfällt die ganze Zeile.
- {{COMPANY_LOCATION}}: PLZ und Stadt (z. B. "80335 München"); ohne PLZ nur die Stadt; ist auch die unbekannt, entfällt die Zeile.
- {{TARGET_JOB_TITLE}}: exakte Positionsbezeichnung aus der Anzeige, inklusive Zusätzen wie "(m/w/d)".
- {{JOB_REFERENCE_OPTIONAL}}: Referenznummer aus der Anzeige im Format " – Ref. 2026-DEV-04"; ohne Referenz vollständig leer.
- {{SALUTATION}}: formale Anrede passend zum Adressaten ("Sehr geehrte Frau Dr. Weber", "Sehr geehrter Herr Müller", "Sehr geehrtes Engineering Hiring Team").

Einstieg
- {{COMPANY_CORE_TECH_FOCUS}}: das technische oder produktseitige Hauptziel der Firma (z. B. "skalierbare Cloud-Microservices", "performante Web-Plattformen", "moderne Data-Pipelines").
- {{COMPANY_SPECIFIC_HOOK}}: was die Firma konkret plant oder baut, aus der Anzeige belegt (z. B. "die Skalierung Ihrer B2B-Plattform", "Ihre neue mobile App-Architektur").
- {{CANDIDATE_PRIMARY_EXPERIENCE}}: die zur Stelle am besten passende Erfahrung des Bewerbers (z. B. "der Architektur moderner Web- und Mobile-Clients", "dem Aufbau robuster TypeScript- und API-Systeme").

Matrix — vier Zeilen Anforderung ↔ Beleg
- {{JOB_REQUIREMENT_1}} … {{JOB_REQUIREMENT_4}}: die vier wichtigsten Anforderungen der Anzeige, prägnant formuliert.
- {{CANDIDATE_PROOF_POINT_1}} … {{CANDIDATE_PROOF_POINT_4}}: der jeweils passende Beleg aus Lebenslauf und Profil-Angaben nach der XYZ-Logik (Ergebnis + Methode/Tool). Hebe in der rechten Spalte insgesamt ein bis zwei Highlights mit <strong>…</strong> hervor (z. B. <strong>phase6</strong>, <strong>Multi-Agenten-KI-Tool</strong>, <strong>Expo EAS</strong>, <strong>100 % TypeScript</strong>).

Schluss
- {{RELEVANT_TECH_STACK_SUMMARY}}: der für die Stelle relevante Stack in einer Wendung (z. B. "im React- und Expo-Ökosystem", "in moderner Software-Architektur und KI-Workflows").
- {{NOTICE_PERIOD}} und {{EARLIEST_START_DATE}}: aus <konditionen>.
- {{SALARY_EXPECTATION_SENTENCE}}: NUR wenn die Anzeige ausdrücklich eine Gehaltsvorstellung verlangt: " Meine Gehaltserwartung liegt bei <Betrag> EUR brutto p.a." (mit führendem Leerzeichen), Betrag nach <konditionen>. Fragt die Anzeige nicht danach, ist der Platzhalter vollständig leer — kein Leerzeichen, kein Text.`;

export function letterPrompt(input: DocumentInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App, und schreibst als erfahrener Tech-Recruiting-Stratege für den Münchner und europäischen Tech-Markt. Erstelle aus der hochgeladenen Anschreiben-Vorlage ein Anschreiben für diese Stelle: "${input.role}" bei ${input.company}. Ziel ist eine maximale Callback- und Interview-Rate bei Engineering Managern und CTOs.

Format: das analytische T-Format (Two-Column Alignment Matrix) — die Vorlage gibt es vor. Es lebt von Scannbarkeit in unter 15 Sekunden.
Tonalität: Engineering-to-Engineering auf Augenhöhe — selbstbewusst, lösungsorientiert, faktenbasiert.
Verboten sind passive Bewerbungsfloskeln: kein "hiermit bewerbe ich mich", kein "mit großem Interesse", kein "hoffe ich auf eine Chance".

Regeln:
- Verändere weder CSS noch HTML-Struktur noch Skripte der Vorlage; fülle nur die Platzhalter in doppelten geschweiften Klammern ({{...}}).
- Fülle jeden Platzhalter nach dem Verzeichnis unten. Bleibt für einen optionalen Platzhalter nichts, entfällt er ersatzlos — samt seiner Zeile, wenn sie sonst leer wäre. Kein Platzhalter bleibt im Ergebnis stehen.
- Platzhalter, die im Verzeichnis fehlen, füllst du sinngemäß nach ihrem Namen.
- Alle Fakten über den Bewerber kommen aus <lebenslauf> (Stationen, Projekte, Stack, Sprachen, Zertifikate) und <profil> (ergänzende Angaben, die der Lebenslauf nicht hat — sie gelten als verbindlich); die Konditionen aus <konditionen>; alles über die Stelle und das Unternehmen aus <anzeige> und <kontakte>. Erfinde nichts — keine Zahlen, keine Adressen, keine Namen.
- Wähle aus dem Lebenslauf die Belege, die zur Anzeige passen — Ergebnis vor Tätigkeit, konkret vor allgemein.
- Beziehe dich konkret auf die Stelle und das Unternehmen; kein generischer Text.
- Perfekte deutsche Grammatik und Interpunktion; Sprache des Briefes ist die Sprache der Vorlage.
- html ist das komplette Dokument, beginnend mit <!doctype html>.

Verzeichnis der Platzhalter:
${PLACEHOLDER_GLOSSARY}

<konditionen>
${TERMS}
</konditionen>

<lebenslauf>
${input.cv ? sealed(documentText(input.cv)) : '(kein Lebenslauf hinterlegt)'}
</lebenslauf>

<kontakte>
${sealed(input.contacts.length ? input.contacts.map((c) => '- ' + c).join('\n') : '(keine bekannt)')}
</kontakte>

${documentContext(input)}`;
}

/* What a document SAYS, not how it is styled: style/script and tags gone,
   the common entities of hand-written templates spelled out, whitespace
   folded. Block-level tags become line breaks so stations stay apart. */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&middot;': '·',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&ndash;': '–',
  '&mdash;': '—',
};

function documentText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/* The checks read only the front of the visible text — a raw head window
   would be all stylesheet on a real template. */
const EXCERPT = 3_000;

export function documentExcerpt(html: string): string {
  return documentText(html).replace(/\s+/g, ' ').slice(0, EXCERPT);
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
