/* The German prompts behind every LLM step. Inputs ride in tagged blocks
   (<anzeige>, <vorlage>, <profil>, <kontakte>) so listing text can never read as
   instructions; the output shape is enforced separately by the JSON Schemas
   in schemas.ts. */
import { VALUE_BUDGET } from './budgets.ts';
import { modelPlaceholders } from './fill.ts';
import type { Extraction } from './schemas.ts';
import { stripMarkup } from '../../src/lib/markup.ts';
import { APPLICANT_EMAIL, APPLICANT_NAME } from '../../src/shared/applicant.ts';
import { DocumentKind, DocumentLanguage } from '../../src/shared/enums.ts';

/* Listings are pages, not books — everything past this is boilerplate, and
   the calls stay affordable. */
const MAX_LISTING = 30_000;

/* Embedded content may not close the tag it is wrapped in — a listing that
   contains a literal </anzeige> would otherwise break out of its block. */
function sealed(text: string): string {
  return text.replace(
    /<\/(anzeige|vorlage|platzhalter|profil|kontakte|lebenslauf-dokument|lebenslauf|anschreiben|brief|stelle|hinweis|karte|personen|kommentare|interviews|aufgaben|frage)>/gi,
    '',
  );
}

function clipListing(text: string): string {
  return sealed(text.length > MAX_LISTING ? text.slice(0, MAX_LISTING) : text);
}

/* Every list in these prompts takes the same shape: one bullet per item, or a
   German stand-in when there is nothing — an empty block reads as an omission
   the model then tries to fill. */
function bullets(items: string[], empty: string): string {
  return sealed(items.length ? items.map((item) => '- ' + item).join('\n') : empty);
}

/* The applicant's facts as the Fassung states them — its text, never its
   markup. Both document prompts and the rewrite ask for exactly this. */
function cvBlock(cv: string | null): string {
  return cv ? sealed(stripMarkup(cv)) : '(kein Lebenslauf hinterlegt)';
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
- language: die Sprache, in der die Anzeige überwiegend geschrieben ist — "de" oder "en". Eine deutsche Anzeige mit englischen Fachbegriffen oder englischem Titel ist "de"; null nur bei einer anderen Sprache.
- textKind: was der Text überhaupt ist — "posting" für eine Stellenanzeige, "cookie_notice" für einen Cookie-Hinweis, "error_page" für eine Fehlerseite, "login_wall" für eine Anmeldeseite, "other" für alles andere (Artikel, Startseite, leere Seite). Null nur, wenn du dich nicht entscheiden kannst.
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
  /* The language of the Fassung and so of every value — the terms and the
     worked examples the prompt hands over are phrased in it, so the model
     never has to translate a German sentence into an English letter. */
  language: DocumentLanguage;
}

/* What the model may answer, and in what shape. Kepler returns the values;
   the document itself is assembled by fillPlaceholders, so nothing outside a
   slot ever passes through a language model. */
const OUTPUT_RULES = `- Antworte ausschließlich mit den Werten der Platzhalter: je Platzhalter ein Eintrag in fields, key ist sein Name ohne geschweifte Klammern, value der einzusetzende Text. Gib niemals das Dokument oder HTML des Gerüsts zurück.
- Jeder Platzhalter aus <platzhalter> braucht einen Eintrag. Bleibt für einen optionalen Platzhalter nichts, ist sein value "" — damit verschwindet er aus dem Dokument.
- In value steht nur der Text für diese eine Stelle, höchstens mit den Auszeichnungen, die die Vorlage dort ohnehin verwendet (z. B. <strong>…</strong>).`;

/* The Fassung goes in as what it SAYS, with its slots in place: the model needs
   to see where a slot sits and how long the text beside it runs, not the
   scaffolding. It is also most of the input saved: a real letter shrinks from
   76 KB to about 1 KB once stylesheet and base64 are gone. */
const documentContext = (input: DocumentInput) => `<anzeige>
${clipListing(input.listing)}
</anzeige>

<vorlage>
${sealed(stripMarkup(input.template))}
</vorlage>

<platzhalter>
${bullets(modelPlaceholders(input.template), '(keine)')}
</platzhalter>

<profil>
${bullets(input.profileFacts, '(keine Angaben)')}
</profil>`;

/* The CV slots. A Lebenslauf is a record, not a sales document — the tailoring
   belongs in the letter, which has a whole requirement matrix for it. So the
   Fassung stays as written and only the line under the name is matched against
   the advertised role. Reordering a skills list would not pay: an ATS matches
   on presence, not position, and a human takes the line in at a glance. */
const cvGlossary = () =>
  `- {{CANDIDATE_HEADER_ROLE}}${budget('CANDIDATE_HEADER_ROLE')}: Unterzeile unter dem Namen (z. B. "Senior Frontend Developer · React, Next.js, Expo"). Die Berufsbezeichnung bleibt die tatsächliche des Bewerbers — gewichtet wird nur, welche seiner Technologien genannt werden und in welcher Reihenfolge, passend zur ausgeschriebenen Rolle. Nur Technologien, die der Lebenslauf ohnehin führt.`;

export function cvPrompt(input: DocumentInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Die hochgeladene Lebenslauf-Vorlage ist ein fertiges Dokument. Schneide sie auf diese Stelle zu, indem du ihre Platzhalter füllst: "${input.role}" bei ${input.company}.

Regeln:
${OUTPUT_RULES}
- Alle Fakten kommen aus der Vorlage; die Profil-Angaben unten dürfen ergänzen, wo sie passen. Erfinde nichts — keine Station, keine Zahl, und vor allem keine Technologie, die nicht im Lebenslauf steht. Fordert die Anzeige etwas, das der Bewerber nicht kann, bleibt es draußen.
- Zahlen werden wörtlich übernommen, samt ihrer Einschränkungen: aus "über 12.000" wird nicht "12.000", aus "bis zu 280 €" nicht "280 €".
- Halte jeden Wert etwa so lang wie der Text in der Vorlage (höchstens rund 10 % Abweichung). Das Layout ist auf eine feste Seitenzahl gerechnet; eine längere Zeile bricht um und verschiebt alles.
- ${TEXT[input.language].languageRule}
- Platzhalter, die im Verzeichnis fehlen, füllst du sinngemäß nach ihrem Namen.

Verzeichnis der Platzhalter:
${cvGlossary()}

${documentContext(input)}`;
}

/* Everything in the prompts that is copied into the document rather than
   read by the model: the terms of the move, the worked examples, and the
   rule naming the language. Each exists once per language the Fassungen
   come in, so an English letter is handed English sentences — a model told
   to write English from a German example sentence translates it, and the
   salary line or the salutation come out one shade off. The prompts around
   them stay German; that is Kepler's voice, not the document's. */
interface LanguageText {
  /* The rule under "Regeln" that names the language of every value. */
  languageRule: string;
  /* What no document holds: the terms of the move itself. Everything else
     about the applicant comes from the Lebenslauf and the Profil-Angaben. */
  terms: string;
  recipientExamples: string;
  recipientFallback: string;
  referenceFormat: string;
  salutationExamples: string;
  hookExamples: string;
  hookOpening: string;
  purposeLead: string;
  purposeExamples: string;
  experienceLead: string;
  experienceExamples: string;
  proofScope: string;
  stackExamples: string;
  salarySentence: string;
  /* How a date reads in a document of this language — what the validation
     pass measures the generated dates against. */
  dateFormat: string;
}

const TEXT: Record<DocumentLanguage, LanguageText> = {
  [DocumentLanguage.DE]: {
    languageRule: 'Sprache: Deutsch, wie die Vorlage. Perfekte deutsche Grammatik und Interpunktion.',
    terms: `Kündigungsfrist: 3 Monate zum Monatsende. Frühester Eintritt: nach Absprache.
Gehaltsvorstellung (nur wenn die Anzeige sie ausdrücklich verlangt): 75.000 EUR bei Mid-Level-Titeln oder kleineren Unternehmen, 80.000 EUR bei Senior-Rollen in Produktfirmen, 85.000 EUR bei Senior-Rollen in Scale-ups, Konzernen oder Fintech oder wenn die Anzeige selbst eine höhere Spanne nennt. Immer eine runde Zahl auf .000, brutto p.a.`,
    recipientExamples: '"Frau Dr. Julia Weber", "Herr Thomas Müller"',
    recipientFallback: '"Engineering Hiring Team"',
    referenceFormat: '" – Ref. 2026-DEV-04"',
    salutationExamples:
      '"Sehr geehrte Frau Dr. Weber", "Sehr geehrter Herr Müller", "Sehr geehrtes Engineering Hiring Team"',
    hookExamples:
      '"Personio nimmt kleinen und mittleren Unternehmen die Personalarbeit ab – und wächst dabei gerade in fünf weitere europäische Märkte.", "Mit Ihrer App bringen Sie Zahnarztpraxen die Terminplanung ins Smartphone."',
    hookOpening: 'Beginnt mit dem Firmennamen oder "Mit Ihrer/Ihrem …"',
    purposeLead: 'als Relativsatz-Fragment nach "Software, die …"',
    purposeExamples:
      '"Personalprozesse für tausende Firmen zuverlässig macht", "Praxen den Alltag spürbar vereinfacht"',
    experienceLead: 'als Objekt zu "in der ich … bereits in Produktion gebracht habe"',
    experienceExamples: '"moderne Web- und Mobile-Clients", "robuste TypeScript- und API-Systeme"',
    proofScope: '"drei Apps in Produktion"',
    stackExamples: '"im React- und Expo-Ökosystem", "in moderner Software-Architektur und KI-Workflows"',
    salarySentence: '" Meine Gehaltserwartung liegt bei <Betrag> EUR brutto p.a."',
    dateFormat: 'DD.MM.YYYY, also 23.08.2026',
  },
  [DocumentLanguage.EN]: {
    languageRule:
      'Sprache: Englisch, wie die Vorlage — British English (Schreibweisen wie "optimised", "organisation"), fehlerfreie Grammatik und Interpunktion. Nur die Werte sind englisch; dieses Verzeichnis und die Regeln bleiben deutsch.',
    terms: `Notice period: 3 months to the end of the month. Earliest start date: by arrangement.
Gehaltsvorstellung (nur wenn die Anzeige sie ausdrücklich verlangt): 75,000 EUR bei Mid-Level-Titeln oder kleineren Unternehmen, 80,000 EUR bei Senior-Rollen in Produktfirmen, 85,000 EUR bei Senior-Rollen in Scale-ups, Konzernen oder Fintech oder wenn die Anzeige selbst eine höhere Spanne nennt. Immer eine runde Zahl auf ,000, gross p.a.`,
    recipientExamples: '"Dr Julia Weber", "Mr Thomas Müller"',
    recipientFallback: '"Engineering Hiring Team"',
    referenceFormat: '" – Ref. 2026-DEV-04"',
    salutationExamples: '"Dear Dr Weber", "Dear Mr Müller", "Dear Engineering Hiring Team"',
    hookExamples:
      '"Personio takes HR administration off the hands of small and medium-sized businesses – and is expanding into five more European markets as it does.", "With your app, dental practices schedule their appointments from a smartphone."',
    hookOpening: 'Beginnt mit dem Firmennamen oder "With your …"',
    purposeLead: 'als Relativsatz-Fragment nach "Software that …"',
    purposeExamples:
      '"makes HR processes reliable for thousands of companies", "noticeably simplifies the day-to-day of practices"',
    experienceLead: 'als Objekt zu "where I have already taken … into production"',
    experienceExamples: '"modern web and mobile clients", "robust TypeScript and API systems"',
    proofScope: '"three apps in production"',
    stackExamples: '"in the React and Expo ecosystem", "in modern software architecture and AI workflows"',
    salarySentence: '" My salary expectation is <Betrag> EUR gross p.a."',
    dateFormat: 'britisches Langformat, also 23 August 2026 — nicht DD.MM.YYYY',
  },
};

/* The budget of a slot as the glossary states it, or nothing for a slot that
   has none. Read from VALUE_BUDGET rather than written into the prose, so the
   number the model is given and the number the check applies are one number. */
function budget(slot: string): string {
  const max = VALUE_BUDGET[slot];
  return max ? ` (höchstens ${max} Wörter)` : '';
}

/* The placeholder glossary is written for the T-format Fassung; a Fassung
   with other names still works through the "sinngemäß" rule at the end. */
const placeholderGlossary = (t: LanguageText) => `Briefkopf und Adressat
- {{CANDIDATE_HEADER_ROLE}}${budget('CANDIDATE_HEADER_ROLE')}: Unterzeile unter dem Namen des Bewerbers, auf die Ausrichtung der Stelle zugeschnitten (z. B. "Senior Frontend Developer · React, Next.js, Expo" oder "Software Developer · TypeScript, Cloud & AI Workflows").
- {{COMPANY_NAME}}: offizieller Name des Unternehmens (z. B. "Personio SE", "BMW Group").
- {{RECIPIENT_NAME}}: Ansprechperson mit Anrede (z. B. ${t.recipientExamples}) — die erste Person aus <kontakte>, sonst die in der Anzeige genannte; gibt es keine: ${t.recipientFallback}.
- {{COMPANY_STREET}}: Straße und Hausnummer, nur wenn die Anzeige sie nennt; sonst entfällt die ganze Zeile.
- {{COMPANY_LOCATION}}: PLZ und Stadt (z. B. "80335 München"); ohne PLZ nur die Stadt; ist auch die unbekannt, entfällt die Zeile.
- {{TARGET_JOB_TITLE}}: exakte Positionsbezeichnung aus der Anzeige, inklusive Zusätzen wie "(m/w/d)".
- {{JOB_REFERENCE_OPTIONAL}}: Referenznummer aus der Anzeige im Format ${t.referenceFormat}; ohne Referenz vollständig leer.
- {{SALUTATION}}: formale Anrede passend zum Adressaten (${t.salutationExamples}).

Einstieg
- {{COMPANY_HOOK_SENTENCE}}${budget('COMPANY_HOOK_SENTENCE')}: ein ganzer Satz über die Firma, aus der Anzeige belegt — was sie baut, für wen, und wenn genannt, wo sie gerade steht (Wachstum, neuer Markt, Relaunch). Nie über Technik, immer über Produkt und Wirkung (z. B. ${t.hookExamples}). ${t.hookOpening} — er ist der erste Satz nach der Anrede. Er enthält mindestens ein Detail, das nur auf diese Firma passt (Produktname, Kundenzahl, Markt, Phase); ist nichts Konkretes belegbar, lieber schlicht formulieren als Allgemeinplätze wie "innovative Lösungen".
- {{COMPANY_PRODUCT_PURPOSE}}${budget('COMPANY_PRODUCT_PURPOSE')}: dieselbe Wirkung ${t.purposeLead} (z. B. ${t.purposeExamples}). Ohne Punkt, ohne Wiederholung des Firmennamens.
- {{CANDIDATE_PRIMARY_EXPERIENCE}}${budget('CANDIDATE_PRIMARY_EXPERIENCE')}: die zur Stelle am besten passende Erfahrung des Bewerbers ${t.experienceLead} (z. B. ${t.experienceExamples}).

Matrix — vier Zeilen Anforderung ↔ Beleg
- {{JOB_REQUIREMENT_1}} … {{JOB_REQUIREMENT_4}}${budget('JOB_REQUIREMENT_1')}: die vier wichtigsten Anforderungen der Anzeige, prägnant formuliert — mit den Wörtern der Anzeige, nicht umschrieben ("Ownership" bleibt "Ownership", "React Native" wird nicht "Mobile"). Reihenfolge nach Gewicht in der Anzeige: was zuerst steht oder als Muss markiert ist, kommt in Zeile 1.
- {{CANDIDATE_PROOF_POINT_1}} … {{CANDIDATE_PROOF_POINT_4}}${budget('CANDIDATE_PROOF_POINT_1')}: der jeweils passende Beleg aus Lebenslauf und Profil-Angaben nach der XYZ-Logik (Ergebnis + Methode/Tool). Jeder Beleg enthält mindestens eine Zahl (Nutzer, Prozent, Dauer, Teamgröße); gibt der Lebenslauf keine her, dann Umfang (${t.proofScope}) statt Adjektiv — keine Zahl erfinden. Hebe in der rechten Spalte insgesamt ein bis zwei Highlights mit <strong>…</strong> hervor (z. B. <strong>phase6</strong>, <strong>Multi-Agenten-KI-Tool</strong>, <strong>Expo EAS</strong>, <strong>100 % TypeScript</strong>).

Schluss
- {{RELEVANT_TECH_STACK_SUMMARY}}${budget('RELEVANT_TECH_STACK_SUMMARY')}: der für die Stelle relevante Stack in einer Wendung (z. B. ${t.stackExamples}).
- {{NOTICE_PERIOD}} und {{EARLIEST_START_DATE}}: aus <konditionen>.
- {{SALARY_EXPECTATION_SENTENCE}}: NUR wenn die Anzeige ausdrücklich eine Gehaltsvorstellung verlangt: ${t.salarySentence} (mit führendem Leerzeichen), Betrag nach <konditionen>. Fragt die Anzeige nicht danach, ist der Platzhalter vollständig leer — kein Leerzeichen, kein Text.`;

export function letterPrompt(input: DocumentInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App, und schreibst als erfahrener Tech-Recruiting-Stratege für den Münchner und europäischen Tech-Markt. Erstelle aus der hochgeladenen Anschreiben-Vorlage ein Anschreiben für diese Stelle: "${input.role}" bei ${input.company}. Ziel ist eine maximale Callback- und Interview-Rate bei Engineering Managern und CTOs.

Format: das analytische T-Format (Two-Column Alignment Matrix) — die Vorlage gibt es vor. Es lebt von Scannbarkeit in unter 15 Sekunden.
Tonalität: Engineering-to-Engineering auf Augenhöhe — selbstbewusst, lösungsorientiert, faktenbasiert.
Verboten sind passive Bewerbungsfloskeln: kein "hiermit bewerbe ich mich", kein "mit großem Interesse", kein "hoffe ich auf eine Chance".

Regeln:
${OUTPUT_RULES}
- Fülle jeden Platzhalter nach dem Verzeichnis unten. Platzhalter, die im Verzeichnis fehlen, füllst du sinngemäß nach ihrem Namen.
- Alle Fakten über den Bewerber kommen aus <lebenslauf> (Stationen, Projekte, Stack, Sprachen, Zertifikate) und <profil> (ergänzende Angaben, die der Lebenslauf nicht hat — sie gelten als verbindlich); die Konditionen aus <konditionen>; alles über die Stelle und das Unternehmen aus <anzeige> und <kontakte>. Erfinde nichts — keine Zahlen, keine Adressen, keine Namen.
- Wähle aus dem Lebenslauf die Belege, die zur Anzeige passen — Ergebnis vor Tätigkeit, konkret vor allgemein.
- Beziehe dich konkret auf die Stelle und das Unternehmen; kein generischer Text.
- ${TEXT[input.language].languageRule}

Verzeichnis der Platzhalter:
${placeholderGlossary(TEXT[input.language])}

<konditionen>
${TEXT[input.language].terms}
</konditionen>

<lebenslauf>
${cvBlock(input.cv)}
</lebenslauf>

<kontakte>
${bullets(input.contacts, '(keine bekannt)')}
</kontakte>

${documentContext(input)}`;
}

/* One marked passage of a finished letter, and what is needed to say it
   differently. The letter arrives as text from the renderer rather than being
   read off disk: what the user marked is what they are looking at, which may
   already carry replacements they have not saved yet. */
export interface VariantsInput {
  /* The whole letter as plain text, so the alternatives fit their surroundings
     — the passage alone would lose the sentence it sits in. */
  letter: string;
  /* The passage as it currently stands, the thing being replaced. */
  passage: string;
  /* What the user typed into the composer, or null when they just want another
     take on it. */
  instruction: string | null;
  listing: string;
  profileFacts: string[];
  cv: string | null;
  company: string;
  role: string;
  count: number;
}

/* The letter is long and the passage is short, so the letter is clipped from
   the front — the marked passage is quoted separately anyway. */
const MAX_LETTER = 12_000;

export function variantsPrompt(input: VariantsInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Im fertigen Anschreiben für "${input.role}" bei ${input.company} hat der Bewerber eine Stelle markiert, die ihm nicht gefällt. Schreibe genau ${input.count} Alternativen dafür.

Regeln:
- Jede Alternative ersetzt den Inhalt von <stelle> eins zu eins. Sie muss sich nahtlos in den Satz einfügen, in dem die Stelle laut <brief> steht: gleiche Zeitform, gleiche Perspektive, passende Groß- oder Kleinschreibung am Anfang. Endet <stelle> ohne Satzzeichen, endet auch deine Alternative ohne eines.
- Gib nur den Text der Stelle zurück — nicht den umgebenden Satz, keine Nummerierung, keine Anführungszeichen, keine Erklärung.
- Alle Fakten stammen aus <lebenslauf>, <profil> und <anzeige>. Erfinde nichts: keine Zahlen, keine Namen, keine Ergebnisse, keine Zeiträume.
- Die ${input.count} Alternativen unterscheiden sich deutlich voneinander — anderer Zugriff, andere Belege oder anderer Satzbau, nicht dreimal derselbe Satz mit getauschten Wörtern.
- Sprache, Ton und Förmlichkeit wie im übrigen Brief. Keine passiven Bewerbungsfloskeln ("hiermit bewerbe ich mich", "mit großem Interesse").
- Als Auszeichnung ist nur <strong>…</strong> erlaubt, höchstens einmal je Alternative und nur dort, wo der Brief das auch sonst tut. Sonst kein HTML.${
    input.instruction
      ? '\n- Was in <hinweis> steht, ist die Anweisung des Bewerbers. Sie geht allen Stilregeln vor — nur die Faktentreue steht darüber.'
      : ''
  }

<stelle>
${sealed(input.passage)}
</stelle>
${
  input.instruction
    ? `
<hinweis>
${sealed(input.instruction)}
</hinweis>
`
    : ''
}
<brief>
${sealed(input.letter.slice(0, MAX_LETTER))}
</brief>

<lebenslauf>
${cvBlock(input.cv)}
</lebenslauf>

<profil>
${bullets(input.profileFacts, '(keine Angaben)')}
</profil>

<anzeige>
${clipListing(input.listing)}
</anzeige>`;
}

/* The checks read only the front of the visible text — a raw head window
   would be all stylesheet on a real template. */
const EXCERPT = 3_000;

export function documentExcerpt(html: string): string {
  return stripMarkup(html).replace(/\s+/g, ' ').slice(0, EXCERPT);
}

/* A whole letter with its tags but without its dead weight. Generous, because
   the model has to be able to quote the end of the document too, and a real
   letter is about 1 KB of actual markup once the two elisions below have run;
   the cap only stops a pathological template from taking the call with it. */
const MARKUP = 40_000;

/* What a MENTIONED document is handed over as — markup, not prose, and that is
   the whole point. The model has to quote a passage back that edits.ts then
   looks for in the file's own bytes, and in a real letter the recipient block
   and the salutation say the same words: only the tags around them tell the
   two apart. A model reading documentExcerpt could never write a quote that
   both is unique and matches.

   So everything quotable survives byte for byte, and only what makes raw HTML
   unreadable goes: the <style>/<script> bodies, and the base64 payload of an
   embedded image — a real letter is 76 KB of mostly base64, which is the
   reason documentExcerpt exists in the first place. Both elisions are safe in
   one direction only, and that is the direction that matters: a quote taken
   from an elided region cannot be found in the file, so applyEdits refuses it
   rather than placing it somewhere wrong. */
export function documentMarkup(html: string): string {
  return (
    html
      .replace(/<(style|script)\b([^>]*)>[\s\S]*?<\/\1>/gi, '<$1$2></$1>')
      /* Quoted or bare — the templates are user-authored HTML this codebase
         does not control. The placeholder keeps the attribute well-formed so
         the model still reads the tag as an image. */
      .replace(/(\bsrc\s*=\s*)(?:"data:[^"]*"|'data:[^']*'|data:[^\s>]*)/gi, '$1"data:…"')
      .slice(0, MARKUP)
      /* A cut landing mid-tag would offer the model half an opening tag as a
         quotable passage — and half a tag IS a byte-exact prefix of the file,
         so applyEdits would happily replace it and break the document. */
      .replace(/<[^>]*$/, '')
  );
}

export function checksPrompt(
  extraction: Extraction,
  contacts: string[],
  cvHtml: string,
  letterHtml: string,
): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Prüfe die erfassten Daten und die Textauszüge der zwei generierten Dokumente auf offensichtliche Fehler.

Prüfe:
- Passen Rolle und Unternehmen in den Dokumenten zu den erfassten Daten?
- Datumsformate (${TEXT[extraction.language ?? DocumentLanguage.DE].dateFormat}), Gehaltsformat, plausible URLs und E-Mail-Adressen des Unternehmens?
- Widersprüche zwischen den Angaben?

Die Kontaktdaten des Bewerbers stehen in <bewerber> und sind richtig, so wie sie dort stehen. Sie sind nie ein Hinweis — auch dann nicht, wenn die Adresse anders aussieht, als der Name vermuten ließe.

<kontakte> sind die der Karte hinterlegten Ansprechpersonen — auch wenn <daten> selbst keine Personen führt (etwa weil eine Person erst nach der Extraktion recherchiert und verknüpft wurde). Nennt ein Dokument dort eine Person, die in <kontakte> steht, ist das korrekt und kein Widerspruch.

issues: höchstens die drei wichtigsten echten Probleme, je EIN kurzer Satz (unter 15 Wörter), ohne Herleitung oder Zitate; hebe den Kern jedes Hinweises mit **fett** hervor (z. B. "**Gehaltsangabe** widerspricht der Anzeige."). Leer, wenn alles stimmig ist.

<bewerber>
Name: ${APPLICANT_NAME}
E-Mail: ${APPLICANT_EMAIL}
</bewerber>

<daten>
${JSON.stringify(extraction, null, 1)}
</daten>

<kontakte>
${bullets(contacts, '(keine bekannt)')}
</kontakte>

<lebenslauf>
${documentExcerpt(cvHtml)}
</lebenslauf>

<anschreiben>
${documentExcerpt(letterHtml)}
</anschreiben>`;
}

/* What the proofs step reads. The documents arrive as the HTML that was just
   written — documentExcerpt turns each into what it says — while the Fassung
   and the profile are the two places a fact may legitimately come from. */
export interface ProofsInput {
  cv: string;
  letter: string;
  /* The selected Lebenslauf Fassung, or null when none is uploaded — then the
     letter had nothing but the profile to work from and the check says so. */
  cvFassung: string | null;
  profileFacts: string[];
}

/* Scoped to the applicant's own facts on purpose: letterPrompt legitimately
   sources the company hook, the product purpose and the requirement matrix
   from <anzeige>, and the notice period / start date / salary sentence from
   <konditionen> — none of which this check ever sees. Handing the posting
   over as a source here would let a fabricated company detail launder
   through as "checked"; the narrower question is what actually protects
   against a fabricated claim without also flagging every legitimate one. */
export function proofsPrompt(input: ProofsInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Prüfe, ob die Aussagen in den zwei erzeugten Dokumenten durch die Quellen gedeckt sind.

Prüfe ausschließlich die Aussagen über den Bewerber: seine Stationen, Zeiträume, Arbeitgeber, Rollen, Technologien, Zahlen und den Umfang seiner Arbeit. Quellen dafür sind allein <lebenslauf> und <profil> — alles andere zählt nicht, auch nicht, was plausibel klingt. Steht dort weniger ("mitgebaut" statt "von Grund auf gebaut"), eine andere Zahl oder gar nichts, ist die Aussage nicht gedeckt.

Nicht deine Aufgabe sind Aussagen über das Unternehmen und die Stelle — die stammen aus der Stellenanzeige, die du hier nicht siehst — und ebenso wenig die Konditionen des Wechsels (Kündigungsfrist, Eintrittstermin, Gehaltsvorstellung). Dazu sagst du nichts, auch wenn sie Zahlen enthalten.

Nicht deine Aufgabe sind außerdem Stil, Ton, Länge und Formulierung.

unsupported: die ungedeckten Aussagen, höchstens fünf. document ist "LEBENSLAUF" oder "COVER_LETTER", quote die Aussage im Wortlaut des Dokuments, why in unter 12 Wörtern, was die Quelle stattdessen hergibt. Leer, wenn alles gedeckt ist.

<anschreiben>
${documentExcerpt(input.letter)}
</anschreiben>

<lebenslauf-dokument>
${documentExcerpt(input.cv)}
</lebenslauf-dokument>

<lebenslauf>
${cvBlock(input.cvFassung)}
</lebenslauf>

<profil>
${bullets(input.profileFacts, '(keine Angaben)')}
</profil>`;
}

/* One entry of the card's comment thread, as Kepler reads it. */
export interface AskComment {
  author: string;
  /* Already formatted for reading (DD.MM.YYYY). */
  date: string;
  text: string;
  /* The comment that addressed Kepler — quoted again as the question. */
  asked: boolean;
}

/* One interview round with the notes taken under it. */
export interface AskInterview {
  title: string;
  /* "erledigt" / "als Nächstes" / "offen", plus the appointment when known. */
  status: string;
  people: string[];
  notes: AskComment[];
}

/* One document the comment mentioned, as documentMarkup left it: the file's
   own bytes, minus the stylesheet and the base64. Markup rather than prose
   because the model has to quote a passage back exactly and that quote is
   matched against those bytes — see documentMarkup for why the flattened text
   the rest of the prompts use cannot carry a quote that both is unique and
   matches. */
export interface AskDocument {
  kind: DocumentKind;
  text: string;
}

/* Everything Kepler sees when a comment addresses it: the card itself, and —
   only when the comment named one — the document it named. It never sees the
   listing; it answers questions about the application, not the posting. */
export interface AskInput {
  company: string;
  role: string;
  /* The first name of whoever asked — the reply opens by addressing them. */
  askedBy: string;
  /* "Label: Wert" lines — stage, summary, dates, the sidebar facts. */
  card: string[];
  people: string[];
  comments: AskComment[];
  interviews: AskInterview[];
  followups: string[];
  profileFacts: string[];
  /* Empty when the comment mentioned no document. */
  documents: AskDocument[];
}

/* Comment threads are short; this only guards against a pasted mail. */
const MAX_COMMENT = 4_000;
/* And a card that has lived long keeps its early history out of the call — the
   question is about now, and the whole thread would be all the call's cost. */
const MAX_THREAD = 60;

function threadLines(entries: AskComment[]): string {
  return entries
    .slice(-MAX_THREAD)
    .map((c) => `${c.author} (${c.date})${c.asked ? ' [diese Frage]' : ''}:\n${c.text.slice(0, MAX_COMMENT)}`)
    .join('\n\n');
}

function interviewBlock(rounds: AskInterview[]): string {
  if (!rounds.length) return '(keine Interviews angelegt)';
  return rounds
    .map((r) =>
      [
        `## ${r.title} — ${r.status}`,
        r.people.length ? `Teilnehmer: ${r.people.join(', ')}` : null,
        r.notes.length ? 'Notizen:\n' + threadLines(r.notes) : '(keine Notizen)',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/* The rules that only exist once a document is on the table. Kept out of the
   prompt entirely otherwise: a model told how to edit will look for something
   to edit. */
const editRules = (docs: AskDocument[]) => `
Die unten stehenden Dokumente sind erwähnt worden. Du darfst sie lesen — und ändern, wenn der Bewerber darum bittet.

Die Dokumente stehen unten als HTML — genau so, wie sie in der Datei stehen. Was du zitierst, wird Zeichen für Zeichen in dieser Datei gesucht; findet es sich dort nicht oder mehrfach, wird gar nichts geändert.

Regeln für Änderungen:
- Jede Änderung ist ein Eintrag in edits. document ist "COVER_LETTER" oder "LEBENSLAUF", kind ist "replace", "delete" oder "insert".
- find ist die Stelle im Dokument, wörtlich und Zeichen für Zeichen so, wie sie unten steht — mitsamt der Tags, die mitten darin stehen. Eine Stelle, die du nicht wörtlich zitieren kannst, änderst du nicht.
- Die Stelle muss im Dokument genau einmal vorkommen. Kommt derselbe Text mehrfach vor, nimm die umgebenden Tags dazu, bis das Zitat eindeutig ist — z. B. \`<p class="empfaenger">Engineering Hiring Team</p>\` statt nur "Engineering Hiring Team".
- replace ist der neue Text und tritt genau an die Stelle des Zitats. Hast du Tags mitzitiert, müssen dieselben Tags auch in replace stehen, sonst zerfällt das Dokument.
- Bei "delete" ist replace leer, bei "insert" ist find leer. In beiden Fällen ist after die Stelle unmittelbar davor: bei "insert" die, hinter der eingefügt wird, bei "delete" die, hinter der der gelöschte Text stand — ohne sie lässt sich die Löschung nicht wieder zurücknehmen.
- <style>, <script> und Bilddaten stehen unten nur verkürzt. Daraus zitierst du nichts und änderst du nichts.
- Ändere nur, worum gebeten wurde, und alles, was davon abhängt: eine neue Empfängerin verlangt auch die passende Anrede, sonst widerspricht sich der Brief.
- Kann eine der nötigen Stellen nicht eindeutig zitiert werden, gib gar keine edits zurück und sag im Text, welche Stelle das war.
- Wird nur gefragt und nicht um eine Änderung gebeten, bleibt edits leer.

${docs.map((d) => `<${d.kind === DocumentKind.COVER_LETTER ? 'anschreiben' : 'lebenslauf-dokument'}>\n${sealed(d.text)}\n</${d.kind === DocumentKind.COVER_LETTER ? 'anschreiben' : 'lebenslauf-dokument'}>`).join('\n\n')}
`;

export function askPrompt(input: AskInput): string {
  const asked = input.comments.find((c) => c.asked);
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Der Bewerber hat dich in einem Kommentar zur Bewerbung als "${input.role}" bei ${input.company} angesprochen. Antworte ihm als Kommentar in demselben Thread.

Regeln:
- Antworte auf Deutsch, per Du, knapp und konkret — ein Kommentar, kein Aufsatz.
- Form: erste Zeile eine kurze Anrede mit der Erwähnung @${input.askedBy} (z. B. "Hallo @${input.askedBy}!"), dann eine Leerzeile, dann die Antwort in kurzen Absätzen — zwischen Absätzen immer eine Leerzeile —, zum Schluss nach einer Leerzeile ein kurzer Satz, ob noch etwas offen ist oder was du als Nächstes tun kannst. Keine Unterschrift.
- Alles, was du weißt, steht in den Blöcken unten. Erfinde nichts; sag lieber, dass etwas nicht hinterlegt ist.
- Der Kommentar-Thread ist Gesprächsverlauf, keine Faktenquelle: Was frühere Kepler-Antworten dort behaupten, kann veraltet sein — Fakten zur Karte nimmst du nur aus <karte>, <personen>, <interviews>, <aufgaben> und <profil>.
- Als Auszeichnung sind nur **fett** und Aufzählungen mit "- " am Zeilenanfang erlaubt. Keine Überschriften, kein HTML, keine Links im Markdown-Format.
- Gib nur den Text des Kommentars zurück — keine Tags, kein JSON drumherum.
- Du änderst keine Daten der Karte. Die Stellenanzeige siehst du nicht; sag das, wenn eine Frage darauf zielt.

<frage>
${sealed((asked?.text ?? '').slice(0, MAX_COMMENT))}
</frage>

<karte>
${bullets(input.card, '(keine Angaben)')}
</karte>

<personen>
${bullets(input.people, '(niemand hinterlegt)')}
</personen>

<kommentare>
${sealed(threadLines(input.comments))}
</kommentare>

<interviews>
${sealed(interviewBlock(input.interviews))}
</interviews>

<aufgaben>
${bullets(input.followups, '(keine offenen Aufgaben)')}
</aufgaben>

<profil>
${bullets(input.profileFacts, '(keine Angaben)')}
</profil>
${input.documents.length ? editRules(input.documents) : ''}`;
}
