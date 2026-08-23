/* Putting the model's answers into a template.

   The model is asked for the placeholder values, not for the finished
   document. Everything outside a slot is therefore copied by this file rather
   than reproduced by a language model — which is the point: a template carries
   tens of kilobytes of base64 image data, and asking for it back verbatim
   returned it with the middle silently missing. */
import { DocumentLanguage } from '../../src/shared/enums.ts';

/* Uppercase only, so CSS rules and script braces are never mistaken for a
   slot: `.a{ color:red }` and `if(x){{y}}` both stay untouched. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/* Script and stylesheet bodies are dropped before the loose scan below: they
   are the one place a brace pair occurs for reasons of its own — `if(x){{y}}`
   and a nested CSS block both read as a slot otherwise. A real slot never sits
   in either, since fillPlaceholders would be rewriting code rather than text. */
const CODE_BLOCK = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/* Anything else shaped like a slot: a name starting with a letter, possibly
   padded or hyphenated. A Fassung is hand-authored, so it can carry
   `{{Anrede}}`, `{{ COMPANY_NAME }}` or `{{JOB-REF}}` — none of which
   PLACEHOLDER matches, which means none is ever offered to the model and none
   would end up in `missing` either. Left alone they sail through as a green
   step with `{{…}}` printed in the finished PDF. */
const SLOT_SHAPED = /\{\{\s*[A-Za-z][\w .-]{0,58}\}\}/g;

/* Slots the template holds that the strict pattern never showed the model.
   Read off the template rather than off the filled document, so a value that
   happens to contain braces is not mistaken for one. */
function unofferedSlots(html: string): string[] {
  const offered = new Set(findPlaceholders(html).map((name) => `{{${name}}}`));
  const found = new Set<string>();
  for (const match of html.replace(CODE_BLOCK, '').matchAll(SLOT_SHAPED)) {
    if (!offered.has(match[0])) found.add(match[0]);
  }
  return [...found];
}

export interface FillResult {
  html: string;
  /* Slots the model did not answer. They stay in the document so the caller
     can fail loudly instead of shipping a PDF with `{{…}}` in it. */
  missing: string[];
}

/* Slots this file fills from what the process knows rather than from an
   answer. A language model has no clock — asked for a date it writes a
   plausible one — so the date is never offered to it: modelPlaceholders keeps
   it out of the prompt and out of the check that every offered slot came back
   answered, and systemValues supplies it at fill time. */
export const SYSTEM_PLACEHOLDERS = ['LETTER_DATE'] as const;

/* Every placeholder a template uses, deduplicated, in the order it first
   appears — the system slots included, because unofferedSlots measures the
   filled document against this list and a name missing here would be reported
   as braces left in the PDF. */
export function findPlaceholders(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(PLACEHOLDER)) found.add(match[1]);
  return [...found];
}

/* The slots the model is asked about — what the prompt lists under
   <platzhalter>, and what the document steps demand a value for. */
export function modelPlaceholders(html: string): string[] {
  const system: readonly string[] = SYSTEM_PLACEHOLDERS;
  return findPlaceholders(html).filter((name) => !system.includes(name));
}

/* How a date reads in a document of each language. The two forms are the ones
   the validation pass is told to expect (see dateFormat in prompts.ts) — a
   letter that dated itself one way and was then checked against the other
   would report a problem on every run. */
const DATE_FORMAT: Record<DocumentLanguage, { locale: string; options: Intl.DateTimeFormatOptions }> = {
  [DocumentLanguage.DE]: {
    locale: 'de-DE',
    options: { day: '2-digit', month: '2-digit', year: 'numeric' },
  },
  [DocumentLanguage.EN]: {
    locale: 'en-GB',
    options: { day: 'numeric', month: 'long', year: 'numeric' },
  },
};

/* The values behind SYSTEM_PLACEHOLDERS, for a document written on `now`. The
   date is the one the document was generated on and stays what it says: a
   letter carries the day it was written, not the day it is looked at again. */
export function systemValues(language: DocumentLanguage, now: Date): Record<string, string> {
  const { locale, options } = DATE_FORMAT[language];
  return { LETTER_DATE: now.toLocaleDateString(locale, options) };
}

export function fillPlaceholders(html: string, values: Record<string, string>): FillResult {
  /* A slot the model was never shown is missing in the only sense that
     matters: it is still in the document. */
  const missing: string[] = unofferedSlots(html);
  /* One pass over the original string: a value that itself contains braces
     lands as text instead of becoming a slot the next replacement fills. The
     function form of replace also keeps `$&` and `$1` literal, which a string
     replacement would swallow. */
  const filled = html.replace(PLACEHOLDER, (whole, key: string) => {
    const value = values[key];
    if (value === undefined) {
      if (!missing.includes(key)) missing.push(key);
      return whole;
    }
    return value;
  });
  return { html: filled, missing };
}
