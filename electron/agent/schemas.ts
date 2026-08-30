/* What the LLM calls return: the JSON Schemas the SDK enforces at generation
   time, and the validators that stand between a structured_output payload and
   the database. The schemas carry the closed value sets, so a compliant model
   never invents a Branche — the validators are the safety net for the rest,
   nulling anything outside a set rather than storing it. */
import { FACT_OPTIONS } from '../../src/data/config.ts';
import { sanitizeInline } from '../../src/lib/inline-html.ts';
import { normalizeSalaryText } from '../../src/lib/salary.ts';
import { normalizeRole } from '../../src/lib/text.ts';
import { isHttpUrl } from '../../src/lib/url.ts';
import type { DocumentEdit } from '../../src/shared/db-types.ts';
import { DocumentKind, DocumentLanguage, EditKind } from '../../src/shared/enums.ts';

/* How many ways to say a passage the rewrite step asks for. Fixed, because the
   popover is built for three rows — a fourth would be generated and dropped. */
export const VARIANT_COUNT = 3;

/* ── Result types ─────────────────────────────────────────────────────── */

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
  /* What the text the run was handed turned out to be. A cookie banner or a
     404 clears the scrape's length check and would otherwise be extracted into
     a confident card built out of nothing — and on the pasted-text path the
     scrape never runs at all, so this is the only place it can be caught.
     Null when the model would not commit; the run then goes on. */
  textKind: TextKind | null;
}

/* One claim in a generated document that nothing in the Lebenslauf or the
   profile backs up. */
export interface UnsupportedClaim {
  document: DocumentKind;
  /* The passage as the document words it — quoted back to the model when the
     letter is rewritten, and shown to the user in the closing comment. */
  quote: string;
  why: string;
}

/* Five is already more than the comment can show; past that the answer is
   the model listing everything it is unsure about rather than what is wrong. */
export const MAX_UNSUPPORTED = 5;

/* ── JSON Schemas for outputFormat ────────────────────────────────────── */

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const nullableString = nullable({ type: 'string' });
const nullableEnum = (values: string[]) => nullable({ type: 'string', enum: values });

/* What the handed-over text is, as the model may name it. A closed set rather
   than free text: the answer reaches the user inside a German sentence, and a
   model inventing its own wording there would write half of that sentence.
   The model only observes — what follows from a kind is orchestrator.ts's
   decision, which is why nothing here is called "blocked" or "rejected". */
export const TEXT_KINDS = ['posting', 'cookie_notice', 'error_page', 'login_wall', 'other'] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

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
    textKind: nullableEnum([...TEXT_KINDS]),
  },
  required: ['role', 'summary', 'company', 'standort', 'gehalt', 'erfahrung', 'language', 'textKind'],
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

/* More improvements than this is a rewrite brief, not feedback — and every
   one of them is quoted back into the regeneration prompt. */
export const MAX_IMPROVEMENTS = 5;

/* The Opus rating of a finished letter: a mark out of ten and the concrete
   changes that would raise it. An empty list is the "ship it" answer. */
export const RATING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 10 },
    improvements: { type: 'array', maxItems: MAX_IMPROVEMENTS, items: { type: 'string' } },
  },
  required: ['score', 'improvements'],
} as const;

export const PROOFS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    unsupported: {
      type: 'array',
      maxItems: MAX_UNSUPPORTED,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document: { type: 'string', enum: [DocumentKind.LEBENSLAUF, DocumentKind.COVER_LETTER] },
          quote: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['document', 'quote', 'why'],
      },
    },
  },
  required: ['unsupported'],
} as const;

/* More than a handful of changes in one comment is not an answer, it is a
   rewrite — and a rewrite belongs in the editor, where each passage can be
   looked at. */
const MAX_EDITS = 8;

/* Kepler's answer to a comment that addressed it, and the changes it made to
   a mentioned document. Most answers carry no edits at all — the array is
   required so a model that changed nothing says so explicitly rather than
   leaving the caller to guess from an absent field. */
export const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    antwort: { type: 'string' },
    edits: {
      type: 'array',
      maxItems: MAX_EDITS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document: { type: 'string', enum: [DocumentKind.LEBENSLAUF, DocumentKind.COVER_LETTER] },
          kind: { type: 'string', enum: [EditKind.REPLACE, EditKind.DELETE, EditKind.INSERT] },
          find: { type: 'string' },
          replace: { type: 'string' },
          after: nullableString,
        },
        required: ['document', 'kind', 'find', 'replace', 'after'],
      },
    },
  },
  /* `edits` is deliberately not required. The CLI enforces this schema before
     validateAsk ever sees the answer, and it rejects a StructuredOutput call
     that misses a required key — at the cost of a turn each time. Asked a
     plain question about a document, the model answers with `antwort` alone
     and no edits key at all, which is exactly right and exactly what the
     prompt asks for ("Wird nur gefragt …, bleibt edits leer"); it was rejected
     three times over and the step died as error_max_turns with a correct
     answer in hand. validateAsk already reads a missing list as no edits, so
     requiring the key here bought nothing and cost the whole call. */
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

export function validateExtraction(x: unknown): Extraction {
  const r = asRecord(x, 'Extraktion');
  const c = typeof r.company === 'object' && r.company !== null ? (r.company as Record<string, unknown>) : {};
  return {
    /* The prompt asks for the title without "(m/w/d)"; the model does not
       always listen, so the cleanup is enforced here as well. */
    role: text(r.role) && normalizeRole(text(r.role)!),
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
    /* Fail open: only a kind the model actually named stops the run. Anything
       outside the closed set is nulled like every other enum here, so a
       misspelling costs the user nothing. */
    textKind: oneOf(r.textKind, [...TEXT_KINDS]) as TextKind | null,
  };
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

export interface LetterRating {
  score: number;
  improvements: string[];
}

/* The rating never throws for the structured shape the SDK guarantees: a
   score outside 0–10 is clamped rather than rejected, because the letter is
   already on disk and correct — a squabble over the mark must not fail the
   step. */
export function validateRating(x: unknown): LetterRating {
  const r = asRecord(x, 'Bewertung');
  const raw = typeof r.score === 'number' && Number.isFinite(r.score) ? Math.round(r.score) : 0;
  const improvements = Array.isArray(r.improvements)
    ? r.improvements.map(text).filter((s): s is string => s !== null)
    : [];
  return { score: Math.max(0, Math.min(10, raw)), improvements: improvements.slice(0, MAX_IMPROVEMENTS) };
}

/* Never throws for the structured-output shape the SDK guarantees — only a
   malformed top-level answer still raises, through asRecord. An empty answer
   means the documents hold up, which is the common case and must not fail the
   step. Entries that name a document the app does not have are dropped rather
   than stored. */
export function validateProofs(x: unknown): UnsupportedClaim[] {
  const r = asRecord(x, 'Belege');
  if (!Array.isArray(r.unsupported)) return [];
  const claims: UnsupportedClaim[] = [];
  for (const entry of r.unsupported) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { document, quote, why } = entry as Record<string, unknown>;
    const kind = text(document);
    const passage = text(quote);
    if (!passage) continue;
    if (kind !== DocumentKind.LEBENSLAUF && kind !== DocumentKind.COVER_LETTER) continue;
    claims.push({ document: kind, quote: passage, why: text(why) ?? '' });
  }
  return claims.slice(0, MAX_UNSUPPORTED);
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

export interface AskAnswer {
  antwort: string;
  edits: DocumentEdit[];
  /* Set when a deletion had to be dropped before ever reaching applyEdits: it
     names a real passage and would place cleanly, but with no anchor
     reverseEdits could never put it back, and the undo is all-or-nothing, so
     it is refused here instead. Dropping anything silently would post the
     reply as a full success with a change quietly missing, while the model's
     own prose still describes it — so every refused entry lands here and is
     appended to the prose, the same way a refusal from applyEdits is. Null
     when nothing was dropped. */
  droppedReason: string | null;
}

/* What to append to the prose when entries were refused. The deletion keeps
   its own sentence while it is the only drop — it is the one refusal that
   names a cause the user could act on; past that a count says more than
   listing four shapes of malformed. */
function droppedReason(dropped: number, onlyDeletion: boolean): string | null {
  if (!dropped) return null;
  if (dropped === 1 && onlyDeletion) {
    return 'Eine Löschung wurde übersprungen, weil sie sich ohne Bezugsstelle nicht zurücknehmen ließe.';
  }
  return dropped === 1
    ? 'Eine Änderung wurde übersprungen, weil sie sich nicht eindeutig zuordnen ließ.'
    : `${dropped} Änderungen wurden übersprungen, weil sie sich nicht eindeutig zuordnen ließen.`;
}

/* The prose is required — an answer with edits and no sentence would leave
   the thread showing changes nobody explained. The edits are filtered rather
   than rejected: one malformed entry should not cost the whole reply, and
   applyEdits refuses anything that still slips through. */
export function validateAsk(x: unknown): AskAnswer {
  const r = asRecord(x, 'Antwort');
  const antwort = text(typeof r.antwort === 'string' ? r.antwort.replace(EDGE_TAGS, '') : r.antwort);
  if (!antwort) throw new Error('Antwort: leer');
  const edits: DocumentEdit[] = [];
  /* A deletion is the one drop with a cause worth naming: it had everything
     needed to place it, and is refused purely so it stays reversible. The
     rest are malformed entries rather than near-misses — they get counted
     instead of described, but none of them stays silent. */
  let droppedDeletion = false;
  /* Every entry this loop refuses, however it was malformed. The prose the
     model wrote already promised all of them, so a drop nobody mentions
     leaves the thread describing a change that never happened. */
  let dropped = 0;
  if (Array.isArray(r.edits)) {
    for (const entry of r.edits) {
      if (typeof entry !== 'object' || entry === null) {
        dropped++;
        continue;
      }
      const e = entry as Record<string, unknown>;
      const document = text(e.document);
      const kind = text(e.kind);
      if (document !== DocumentKind.LEBENSLAUF && document !== DocumentKind.COVER_LETTER) {
        dropped++;
        continue;
      }
      if (kind !== EditKind.REPLACE && kind !== EditKind.DELETE && kind !== EditKind.INSERT) {
        dropped++;
        continue;
      }
      const find = typeof e.find === 'string' ? e.find : '';
      const replace = typeof e.replace === 'string' ? e.replace : '';
      const after = text(e.after);
      /* Each kind needs the half it is located by — and a deletion needs both:
         `find` to place it, and `after` so reverseEdits has an anchor to put
         the text back behind. A delete stored without one can never be undone,
         and the undo is all-or-nothing, so it would take the whole set with
         it. Dropped here, exactly like a replacement with nothing to find. */
      if (kind !== EditKind.INSERT && !find) {
        dropped++;
        continue;
      }
      if (kind !== EditKind.REPLACE && !after) {
        if (kind === EditKind.DELETE) droppedDeletion = true;
        dropped++;
        continue;
      }
      /* A change that writes nothing is not a change: applyEdits places the
         empty string, reports success, and reverseEdits then turns it into a
         needle of '' that occurrences() can never find — taking the whole
         set's undo with it, since the undo is all-or-nothing. An emptying
         change has to be expressed as an anchored deletion. */
      if (kind !== EditKind.DELETE && !replace) {
        dropped++;
        continue;
      }
      edits.push({ document, kind, find, replace, after });
    }
  }
  const kept = edits.slice(0, MAX_EDITS);
  /* Truncation is a drop like any other — silently keeping the first eight
     would report a nine-change answer as fully applied. */
  dropped += edits.length - kept.length;
  return { antwort, edits: kept, droppedReason: droppedReason(dropped, droppedDeletion) };
}
