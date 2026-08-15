/* Best-effort reading of a job posting URL. Until Kepler really fetches the
   page, the host names the company and the last path segment names the role;
   anything unparseable falls back to the generic placeholders. */
import { cap } from '../../lib/text';
import { UNKNOWN_COMPANY, UNKNOWN_ROLE } from '../../shared/domain';

export interface Posting {
  role: string;
  company: string;
}

export { UNKNOWN_COMPANY, UNKNOWN_ROLE };

export function parsePosting(url: string): Posting {
  const posting: Posting = { role: UNKNOWN_ROLE, company: UNKNOWN_COMPANY };
  const trimmed = (url || '').trim();
  if (!trimmed) return posting;

  try {
    const u = new URL(/^https?:/.test(trimmed) ? trimmed : 'https://' + trimmed);
    const host = u.hostname.replace(/^(www|karriere|jobs|career)\./, '').split('.')[0];
    if (host) posting.company = host.split('-').map(cap).join(' ');
    const slug = (u.pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]?\d+$/, '');
    if (slug) posting.role = slug.split(/[-_]/).filter(Boolean).map(cap).join(' ');
  } catch {
    /* keep the generic defaults */
  }

  return posting;
}
