/* What the LLM calls return: the JSON Schemas the SDK enforces at generation
   time, and the validators that stand between a structured_output payload and
   the database. The schemas carry the closed value sets, so a compliant model
   never invents a Branche — the validators are the safety net for the rest,
   nulling anything outside a set rather than storing it. */
import { FACT_OPTIONS } from '../../src/data/config.ts';
import { sanitizeInline } from '../../src/lib/inline-html.ts';
import { normalizeSalaryText } from '../../src/lib/salary.ts';
import { isHttpUrl } from '../../src/lib/url.ts';
import { DocumentLanguage } from '../../src/shared/enums.ts';

/* How many ways to say a passage the rewrite step asks for. Fixed, because the
   popover is built for three rows — a fourth would be generated and dropped. */
export const VARIANT_COUNT = 3;

/* ── Result types ─────────────────────────────────────────────────────── */

export interface ExtractedPerson {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
}

export interface Extraction {
  role: string | null;
  summary: string | null;
  company: {
    name: string | null;
    sector: string | null;
    headcount: string | null;
    homepage: string | null;
    email: string | null;
    phone: string | null;
  };
  standort: string | null;
  gehalt: string | null;
  erfahrung: string | null;
  /* The language the posting is written in — which side of the template
     slots the run reads, unless the card already says. Null when unclear. */
  language: DocumentLanguage | null;
  people: ExtractedPerson[];
}

/* ── JSON Schemas for outputFormat ────────────────────────────────────── */

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const nullableString = nullable({ type: 'string' });
const nullableEnum = (values: string[]) => nullable({ type: 'string', enum: values });

const PERSON_PROPS = {
  name: { type: 'string' },
  role: nullableString,
  email: nullableString,
  phone: nullableString,
  linkedin: nullableString,
};

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: nullableString,
    summary: nullableString,
    company: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: nullableString,
        sector: nullableEnum(FACT_OPTIONS.Branche),
        headcount: nullableEnum(FACT_OPTIONS.Mitarbeiterzahl),
        homepage: nullableString,
        email: nullableString,
        phone: nullableString,
      },
      required: ['name', 'sector', 'headcount', 'homepage', 'email', 'phone'],
    },
    standort: nullableString,
    gehalt: nullableString,
    erfahrung: nullableEnum(FACT_OPTIONS.Erfahrung),
    language: nullableEnum(Object.values(DocumentLanguage)),
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: PERSON_PROPS,
        required: ['name'],
      },
    },
  },
  required: ['role', 'summary', 'company', 'standort', 'gehalt', 'erfahrung', 'language', 'people'],
} as const;

export const CONTACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    person: nullable({
      type: 'object',
      additionalProperties: false,
      properties: PERSON_PROPS,
      required: ['name'],
    }),
  },
  required: ['person'],
} as const;

/* The answered placeholder slots. A list of pairs rather than an object,
   because the slot names come from whichever Fassung the user uploaded — a
   schema with fixed properties could not describe them. */
export const FILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fields: {
      type: 'array',
      /* Every Fassung that reaches this step has at least one slot, so an empty
         array is never a valid answer — saying so lets the SDK reject it before
         the validator has to. */
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value'],
      },
    },
  },
  required: ['fields'],
} as const;

export const CHECKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { issues: { type: 'array', items: { type: 'string' } } },
  required: ['issues'],
} as const;

/* Kepler's answer to a comment that addressed it. */
export const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { antwort: { type: 'string' } },
  required: ['antwort'],
} as const;

export const VARIANTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    variants: {
      type: 'array',
      minItems: VARIANT_COUNT,
      maxItems: VARIANT_COUNT,
      items: { type: 'string' },
    },
  },
  required: ['variants'],
} as const;

/* ── Validators ───────────────────────────────────────────────────────── */

function asRecord(x: unknown, what: string): Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    throw new Error(`${what}: kein Objekt erhalten`);
  }
  return x as Record<string, unknown>;
}

/* A non-empty trimmed string, or null for everything else. */
function text(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t || null;
}

/* A web address, or nothing: the model sometimes answers "helios.de", and a
   value that is not a full URL is not a link the app can open. */
function httpUrl(x: unknown): string | null {
  const t = text(x);
  return t && isHttpUrl(t) ? t : null;
}

function oneOf(x: unknown, values: string[]): string | null {
  const t = text(x);
  return t && values.includes(t) ? t : null;
}

function person(x: unknown): ExtractedPerson | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  const name = text(r.name);
  if (!name) return null;
  return {
    name,
    role: text(r.role),
    email: text(r.email),
    phone: text(r.phone),
    linkedin: text(r.linkedin),
  };
}

export function validateExtraction(x: unknown): Extraction {
  const r = asRecord(x, 'Extraktion');
  const c = typeof r.company === 'object' && r.company !== null ? (r.company as Record<string, unknown>) : {};
  const people = Array.isArray(r.people)
    ? r.people.map(person).filter((p): p is ExtractedPerson => p !== null)
    : [];
  return {
    role: text(r.role),
    summary: text(r.summary),
    company: {
      name: text(c.name),
      sector: oneOf(c.sector, FACT_OPTIONS.Branche),
      headcount: oneOf(c.headcount, FACT_OPTIONS.Mitarbeiterzahl),
      homepage: httpUrl(c.homepage),
      email: text(c.email),
      phone: text(c.phone),
    },
    standort: text(r.standort),
    /* Re-said in the salary dropdowns' vocabulary — whole thousands, never
       the decimals a listing's "87.700 €" would otherwise smuggle in. */
    gehalt: ((g) => (g ? normalizeSalaryText(g) : null))(text(r.gehalt)),
    erfahrung: oneOf(r.erfahrung, FACT_OPTIONS.Erfahrung),
    language: oneOf(r.language, Object.values(DocumentLanguage)) as DocumentLanguage | null,
    people,
  };
}

export function validateContact(x: unknown): ExtractedPerson | null {
  const r = asRecord(x, 'Kontaktsuche');
  return person(r.person);
}

/* The slots the model answered, as a lookup for fillPlaceholders. An empty
   value is an answer, not an omission: the letter glossary has optional slots
   that are meant to vanish, and dropping them here would make them look
   unanswered — which is what the caller fails the step over.

   Each value is escaped down to the inline tags a document may carry, the same
   as a rewrite suggestion and for the same reason: it is substituted into the
   user's own document, which is then loaded by a real browser window to be
   printed. Unescaped, a value carrying markup — whether the listing talked the
   model into it or it simply answered "R&D" — would rewrite the template
   around the slot. This is exactly what the prompt already asks for: OUTPUT_RULES
   permits a value the emphasis the Fassung uses at that spot, nothing more. */
export function validateFill(x: unknown): Record<string, string> {
  const r = asRecord(x, 'Platzhalter');
  if (!Array.isArray(r.fields)) throw new Error('Platzhalter: keine Werte erhalten');
  const values: Record<string, string> = {};
  for (const entry of r.fields) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, value } = entry as Record<string, unknown>;
    const name = text(key);
    if (!name) continue;
    values[name] = sanitizeInline(typeof value === 'string' ? value : '');
  }
  return values;
}

export function validateChecks(x: unknown): string[] {
  const r = asRecord(x, 'Prüfung');
  if (!Array.isArray(r.issues)) return [];
  return r.issues.map(text).filter((s): s is string => s !== null);
}

/* The rewrite suggestions. Short of the full count the answer is rejected so
   the runner asks again — a popover with two rows where three were promised is
   worse than one more call. Each one is escaped down to the inline tags a
   letter may carry: it is about to be written into the user's own document. */
export function validateVariants(x: unknown): string[] {
  const r = asRecord(x, 'Vorschläge');
  const list = Array.isArray(r.variants) ? r.variants.map(text).filter((s): s is string => s !== null) : [];
  if (list.length < VARIANT_COUNT) {
    throw new Error(`Vorschläge: ${VARIANT_COUNT} erwartet, ${list.length} erhalten`);
  }
  return list.slice(0, VARIANT_COUNT).map(sanitizeInline);
}

/* The reply comment. Trimmed, never empty — an empty answer would post a blank
   Kepler comment, and the runner does better asking again. Plain text: the
   thread renders **fett** and "- " bullets itself, so nothing is escaped here.
   Tag-like fragments at either end are dropped: the model has been seen to
   close the answer with the tag it imagined it was writing into
   ("…Sag Bescheid.</antwort></invoke>"), and that is not part of what it said. */
const EDGE_TAGS = /^(?:\s*<\/?[a-z_][\w-]*[^>]*>)+|(?:<\/?[a-z_][\w-]*[^>]*>\s*)+$/gi;

export function validateAsk(x: unknown): string {
  const r = asRecord(x, 'Antwort');
  const t = text(typeof r.antwort === 'string' ? r.antwort.replace(EDGE_TAGS, '') : r.antwort);
  if (!t) throw new Error('Antwort: leer');
  return t;
}
