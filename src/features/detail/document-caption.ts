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
