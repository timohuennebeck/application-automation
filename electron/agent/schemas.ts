/* What the LLM calls return: the JSON Schemas the SDK enforces at generation
   time, and the validators that stand between a structured_output payload and
   the database. The schemas carry the closed value sets, so a compliant model
   never invents a Branche — the validators are the safety net for the rest,
   nulling anything outside a set rather than storing it. */
import { FACT_OPTIONS } from '../../src/data/config.ts';
import { normalizeSalaryText } from '../../src/lib/salary.ts';
import { isHttpUrl } from '../../src/lib/url.ts';

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
  required: ['role', 'summary', 'company', 'standort', 'gehalt', 'erfahrung', 'people'],
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

export const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { html: { type: 'string' } },
  required: ['html'],
} as const;

export const CHECKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { issues: { type: 'array', items: { type: 'string' } } },
  required: ['issues'],
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
    people,
  };
}

export function validateContact(x: unknown): ExtractedPerson | null {
  const r = asRecord(x, 'Kontaktsuche');
  return person(r.person);
}

/* The generated document must be a whole page — the file becomes the stored
   HTML source and the PDF is printed straight from it. */
export function validateDocumentHtml(x: unknown): string {
  const r = asRecord(x, 'Dokument');
  const html = typeof r.html === 'string' ? r.html.trim() : '';
  if (!/^<!doctype html/i.test(html) && !/^<html[\s>]/i.test(html)) {
    throw new Error('Dokument: kein vollständiges HTML erhalten');
  }
  return html;
}

export function validateChecks(x: unknown): string[] {
  const r = asRecord(x, 'Prüfung');
  if (!Array.isArray(r.issues)) return [];
  return r.issues.map(text).filter((s): s is string => s !== null);
}
