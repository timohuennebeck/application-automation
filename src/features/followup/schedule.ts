import { DETAILS } from '../../data/sample-data';
import { dayDiff, shiftISO, todayISO } from '../../lib/date';
import type { AppState } from '../../state/store-context';

export interface FollowUpSlot {
  index: number;
  title: string;
  iso: string;
  diff: number;
  /* "heute" / "in 9 Tagen" / "überfällig" */
  meta: string;
  dot: string;
  kind: 'filled' | 'pie' | 'dashed';
  /* Overdue and far-future follow-ups are de-emphasised. */
  dim: number;
}

const DEFAULT_UPCOMING: [string, string][] = [
  ['in 9 Tagen', 'Erneutes Follow up'],
  ['in 25 Tagen', 'Letztes Follow up'],
];

/* The planned follow-up sequence for a card: an immediate one plus the
   card's scheduled repeats, each with any user override applied.
   The first follow-up is anchored to the start of September, matching the
   design prototype's sample timeline. */
export function followUpSlots(st: AppState, cardId: string): FollowUpSlot[] {
  const upcoming = DETAILS[cardId]?.upcoming || DEFAULT_UPCOMING;
  const today = todayISO();

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const anchor = new Date(midnight.getFullYear(), midnight.getMonth() >= 8 ? midnight.getMonth() : 8, 1);
  if (anchor < midnight) anchor.setTime(midnight.getTime());
  const base = Math.round((anchor.getTime() - midnight.getTime()) / 86400000);

  const offsets = [0, ...upcoming.map((u) => +(u[0].match(/\d+/) || ['0'])[0])].map((o) => base + o);

  return offsets.map((off, index) => {
    const iso = st.dueOverrides[cardId + ':' + index] || shiftISO(today, off);
    const diff = dayDiff(iso);
    return {
      index,
      title: index === 0 ? 'Follow up zur Bewerbung' : upcoming[index - 1][1],
      iso,
      diff,
      meta: diff === 0 ? 'heute' : diff === 1 ? 'morgen' : diff > 0 ? 'in ' + diff + ' Tagen' : 'überfällig',
      dot: diff < 0 ? 'var(--c-a8523f)' : diff <= 1 ? 'var(--c-d0a03f)' : 'var(--c-c9c5bb)',
      kind: diff < 0 ? 'filled' : diff <= 1 ? 'pie' : 'dashed',
      dim: diff < 0 || diff > 7 ? 0.5 : 1,
    };
  });
}

/* Chip and menu label: names the role, elided to keep the chip compact. */
export function slotLabel(slot: FollowUpSlot, role: string): string {
  const full = slot.index === 0 ? 'Follow up zur Bewerbung als ' + role : slot.title + ': ' + role;
  return full.length > 32 ? full.slice(0, 32).trim() + '…' : full;
}

/* Kepler's drafted follow-up. Tone escalates across the sequence, and the last
   one explicitly offers to close the loop. */
export function draftEmail(slots: FollowUpSlot[], sel: number, role: string, company: string, contactName: string) {
  const isLast = sel === slots.length - 1 && sel > 0;
  const greeting = contactName ? 'Hallo ' + contactName.split(' ')[0] : 'Hallo';

  const body = sel === 0
    ? 'vor einigen Tagen habe ich mich bei ' + company + ' als ' + role + ' beworben. Ich wollte kurz nachfragen, ob meine Unterlagen angekommen sind und wie der aktuelle Stand im Auswahlprozess ist.\n\nAn der Rolle bin ich weiterhin sehr interessiert und stehe für Rückfragen oder ein Gespräch gerne zur Verfügung.'
    : isLast
      ? 'ich melde mich ein letztes Mal zu meiner Bewerbung als ' + role + ' bei ' + company + '. Falls die Stelle inzwischen besetzt ist, freue ich mich über eine kurze Rückmeldung — ansonsten bleibe ich gerne im Gespräch.'
      : 'ich wollte mich noch einmal zu meiner Bewerbung als ' + role + ' bei ' + company + ' melden. Mein Interesse an der Rolle besteht unverändert — gibt es inzwischen einen neuen Stand?';

  return {
    subject: sel === 0 ? 'Follow up zur Bewerbung als ' + role : slots[sel].title + ': ' + role,
    body: greeting + ',\n\n' + body + '\n\nViele Grüße\nSarah Thal',
  };
}
