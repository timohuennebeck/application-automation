import { DotKind } from '../../data/config';
import { dayDiff } from '../../lib/date';
import type { AppState } from '../../state/store-context';

export interface FollowUpSlot {
  index: number;
  /* followups row id — the handle for setDue/saveEmail. */
  id: number;
  title: string;
  iso: string;
  diff: number;
  /* "heute" / "in 9 Tagen" / "überfällig" */
  meta: string;
  dot: string;
  kind: DotKind;
  /* Overdue and far-future follow-ups are de-emphasised. */
  dim: number;
  /* The stored draft; null until it has been generated once. */
  emailSubject: string | null;
  emailText: string | null;
}

/* The card's follow-up sequence, straight from its followups rows. */
export function followUpSlots(st: AppState, cardId: string): FollowUpSlot[] {
  const rows = (st.followupsByApp[cardId] || []).slice().sort((a, b) => a.position - b.position);

  return rows.map((f, index) => {
    const diff = dayDiff(f.due_at);
    return {
      index,
      id: f.id,
      title: f.label,
      iso: f.due_at,
      diff,
      meta: diff === 0 ? 'heute' : diff === 1 ? 'morgen' : diff > 0 ? 'in ' + diff + ' Tagen' : 'überfällig',
      dot: diff < 0 ? 'var(--c-a8523f)' : diff <= 1 ? 'var(--c-d0a03f)' : 'var(--c-c9c5bb)',
      kind: diff < 0 ? DotKind.FILLED : diff <= 1 ? DotKind.PIE : DotKind.DASHED,
      dim: diff < 0 || diff > 7 ? 0.5 : 1,
      emailSubject: f.email_subject,
      emailText: f.email_text,
    };
  });
}

/* Chip and menu label: names the role, elided to keep the chip compact. */
export function slotLabel(slot: FollowUpSlot, role: string): string {
  const full = slot.index === 0 ? 'Follow up zur Bewerbung als ' + role : slot.title + ': ' + role;
  return full.length > 32 ? full.slice(0, 32).trim() + '…' : full;
}

/* Kepler's drafted follow-up. Tone escalates across the sequence, and the last
   one explicitly offers to close the loop. Drafts are generated once and then
   stored on the followups row — see saveEmailDraft. */
export function draftEmail(
  slots: FollowUpSlot[],
  sel: number,
  role: string,
  company: string,
  contactName: string,
) {
  const isLast = sel === slots.length - 1 && sel > 0;
  const greeting = contactName ? 'Hallo ' + contactName.split(' ')[0] : 'Hallo';

  const body =
    sel === 0
      ? 'vor einigen Tagen habe ich mich bei ' +
        company +
        ' als ' +
        role +
        ' beworben. Ich wollte kurz nachfragen, ob meine Unterlagen angekommen sind und wie der aktuelle Stand im Auswahlprozess ist.\n\nAn der Rolle bin ich weiterhin sehr interessiert und stehe für Rückfragen oder ein Gespräch gerne zur Verfügung.'
      : isLast
        ? 'ich melde mich ein letztes Mal zu meiner Bewerbung als ' +
          role +
          ' bei ' +
          company +
          '. Falls die Stelle inzwischen besetzt ist, freue ich mich über eine kurze Rückmeldung — ansonsten bleibe ich gerne im Gespräch.'
        : 'ich wollte mich noch einmal zu meiner Bewerbung als ' +
          role +
          ' bei ' +
          company +
          ' melden. Mein Interesse an der Rolle besteht unverändert — gibt es inzwischen einen neuen Stand?';

  return {
    subject: sel === 0 ? 'Follow up zur Bewerbung als ' + role : slots[sel].title + ': ' + role,
    body: greeting + ',\n\n' + body + '\n\nViele Grüße\nSarah Thal',
  };
}
