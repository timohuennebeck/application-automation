import { isoToDate } from '../../lib/date';
import type { DocumentRow } from '../../shared/db-types';

/* "erstellt am 14.08.2026 · Fassung Kurz" — the day the card stands for and,
   for a generated document, the profile Fassung it came from. A hand-uploaded
   file, or one from before Fassungen, has no label and says only the day. */
export function documentCaption(
  d: Pick<DocumentRow, 'created_at' | 'updated_at' | 'template_label'>,
): string {
  const updated = d.updated_at > d.created_at;
  const day = isoToDate((updated ? d.updated_at : d.created_at).slice(0, 10));
  const base = (updated ? 'aktualisiert am ' : 'erstellt am ') + day;
  return d.template_label ? base + ' · Fassung ' + d.template_label : base;
}

/* What the card is headed with: the name the file actually carries on disk —
   an English application's letter is a "…_Cover_Letter.html", and calling it
   "Anschreiben" on the card claims a German document that is not there. The
   row's stored title is only the fallback for a slot without a file. */
export function documentDisplayName(d: Pick<DocumentRow, 'title' | 'file_path' | 'pdf_path'>): string {
  const stored = d.file_path ?? d.pdf_path;
  if (!stored) return d.title;
  /* Stored paths are joined by the main process, so the separator is the
     platform's — split on either. */
  return stored.slice(Math.max(stored.lastIndexOf('/'), stored.lastIndexOf('\\')) + 1);
}
