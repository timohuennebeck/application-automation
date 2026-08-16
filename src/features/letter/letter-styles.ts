/* The stylesheet the editor injects into the letter's own document.

   It cannot use the app's custom properties: the iframe is a separate document
   and `var(--c-f7e9b8)` resolves to nothing there. The literals below are the
   light-mode values of the tokens they stand for, which is also the right call
   independently — the letter is paper. It stays white when the app goes dark,
   the same way the printed PDF does. */
import { MARK_ATTR, STOP_ATTR, STYLE_ATTR, TAG_ATTR } from './mark';

/* --c-f7e9b8 over --c-d9a437: the amber the search hit already wears. */
const MARK_TINT = '#f7e9b8';
const MARK_RULE = '#d9a437';
/* --c-4f8f6a at the mixes the app uses for a settled state. */
const DONE_TINT = 'rgba(79, 143, 106, 0.12)';
const DONE_RULE = 'rgba(79, 143, 106, 0.55)';
/* --c-fff, --c-e6e3dc, --c-1b1a17 and --c-a5a29a for the working tag. */
const PAPER = '#fff';
const TAG_BORDER = '#e6e3dc';
const INK = '#1b1a17';
const MUTED = '#a5a29a';

const LETTER_CSS = `
/* A template carries its margins in @page, which only applies when printing —
   on screen the text would otherwise run the full width of the pane and read
   nothing like the PDF beside it. Constraining the body to a page width and
   centring it is the smallest change that gets the two to agree: max-width
   only ever narrows, so a template that already sets a width keeps it. */
@media screen {
  /* The ground around the sheet is app chrome, not document — it carries the
     page's own background so the letter does not sit on a second surface with
     a hard edge against the breadcrumb. The value is handed in by the editor
     because the token behind it lives in the other document. */
  html { background: var(--kepler-ground, #fbfaf7); padding: 26px 0; }
  body {
    max-width: 210mm;
    margin-left: auto;
    margin-right: auto;
    background: #fff;
    /* The ground is nearly white in the light theme, so the sheet's edge can no
       longer come from contrast alone. The hairline is black at 6 %: enough to
       find the paper's edge on a pale ground, invisible against a dark one. */
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.06),
      0 4px 18px rgba(60, 50, 35, 0.14);
  }
}
/* Only the top corners are rounded: the underline below is an inset shadow,
   and a rounded bottom corner makes it curve up at both ends. */
[${MARK_ATTR}] {
  border-radius: 2px 2px 0 0;
  background: ${MARK_TINT};
  box-shadow: inset 0 -1.5px 0 ${MARK_RULE};
  transition: background 140ms ease;
}
[${MARK_ATTR}='working'] {
  background: linear-gradient(90deg, #f1efe9 25%, #e4e1da 50%, #f1efe9 75%);
  background-size: 200% 100%;
  animation: kepler-shimmer 1.3s linear infinite;
  box-shadow: none;
  color: transparent;
}
/* Emphasis inside the passage sets its own colour, so it has to be masked too
   — otherwise the bold words stay legible through the shimmer. */
[${MARK_ATTR}='working'] * { color: transparent; }
[${MARK_ATTR}='done'] {
  background: ${DONE_TINT};
  box-shadow: inset 0 -1.5px 0 ${DONE_RULE};
  cursor: pointer;
}
@keyframes kepler-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

/* The tag that rides beside a passage while Kepler rewrites it. It sits in the
   letter's flow, so it takes a system sans of its own — it is a piece of the
   app that happens to stand on the page, not a piece of the letter. */
[${TAG_ATTR}] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  margin-left: 6px;
  background: ${PAPER};
  border: 1px solid ${TAG_BORDER};
  border-radius: 999px;
  padding: 2px 10px 2px 3px;
  box-shadow: 0 1px 2px rgba(60, 50, 35, 0.05);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  white-space: nowrap;
  user-select: none;
}
[${TAG_ATTR}] i {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: ${INK};
  color: ${PAPER};
  font-size: 8px;
  font-weight: 600;
  font-style: normal;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
/* The same running highlight the run panel puts on its live step label. */
[${TAG_ATTR}] b {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  color: transparent;
  background-image: linear-gradient(
    90deg, ${MUTED} 0%, ${MUTED} 28%, ${INK} 46%, ${MUTED} 64%, ${MUTED} 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: kepler-shimmer 2.4s linear infinite;
}

/* The square that calls the rewrite off. Same glyph as the stop on a run step,
   at the size of the tag it sits in. */
[${TAG_ATTR}] [${STOP_ATTR}] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* The same box as the K avatar beside it: with one item taller than the
     others, the flex line grows around it and the row reads off-centre. */
  width: 15px;
  height: 15px;
  margin-left: 2px;
  margin-right: -4px;
  border-radius: 50%;
  color: ${MUTED};
  cursor: pointer;
}
[${TAG_ATTR}] [${STOP_ATTR}]:hover { background: #f1efe9; color: ${INK}; }
[${TAG_ATTR}] [${STOP_ATTR}] svg { display: block; width: 9px; height: 9px; }

/* Answers waiting on a passage the user walked away from. This is a control,
   not a progress indicator: it wears the mark's own amber so the pill and the
   passage read as one thing, and it holds still.

   These rules must stay below the ones above — [attr='v'] and [attr] carry the
   same specificity, so only their order decides which one wins. */
[${TAG_ATTR}='ready'] {
  background: ${MARK_TINT};
  border-color: ${MARK_RULE};
  cursor: pointer;
}
[${TAG_ATTR}='ready']:hover {
  background: ${MARK_RULE};
}
[${TAG_ATTR}='ready'] b {
  color: ${INK};
  background-image: none;
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  [${MARK_ATTR}='working'], [${TAG_ATTR}] b { animation: none; }
}

/* Printing means printing the letter, not the editing of it. Everything
   serializeLetter takes off on the way to disk has to come off here too:
   the marks and their pills live in this document, so without these rules ⌘P
   would put amber highlights and "Kepler erstellt Optionen…" on paper.

   Below the rules above, because [attr='v'] and [attr] carry the same
   specificity and only their order decides. */
@media print {
  [${TAG_ATTR}] { display: none; }
  [${MARK_ATTR}],
  [${MARK_ATTR}='working'],
  [${MARK_ATTR}='done'] {
    background: none;
    box-shadow: none;
    /* The working state paints its text transparent to shimmer under it. */
    color: inherit;
    animation: none;
  }
  [${MARK_ATTR}='working'] * { color: inherit; }
}
`;

/* The letter as the iframe should receive it: with the editor's stylesheet
   already in the head.

   Appending it on load meant the frame painted once with the template's own CSS
   — full width, because a template carries its margins in @page, which screens
   ignore — and then jumped to page width when the sheet arrived. Carrying it in
   the source removes the first paint, and nothing is lost on the way out:
   serializeLetter strips [STYLE_ATTR] either way. */
export function withEditorStyles(html: string): string {
  const sheet = `<style ${STYLE_ATTR}>${LETTER_CSS}</style>`;
  /* At the END of the head: these rules and a template's own carry the same
     specificity, so only order decides, and the editor's have to win — put in
     front, the page width would be overridden by whatever the template sets.
     A template without a head still parses correctly with the sheet in front of
     <body>, since the parser hoists it. */
  const close = /<\/head\s*>/i.exec(html);
  if (close) return html.slice(0, close.index) + sheet + html.slice(close.index);
  const body = /<body[^>]*>/i.exec(html);
  return body ? html.slice(0, body.index) + sheet + html.slice(body.index) : sheet + html;
}
