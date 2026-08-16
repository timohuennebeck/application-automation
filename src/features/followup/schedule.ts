import { DotKind } from '../../data/config';
import { dayDiff, relLabel } from '../../lib/date';
import { APPLICANT_NAME } from '../../shared/applicant';
import { UNKNOWN_COMPANY, UNKNOWN_ROLE } from '../../shared/domain';
import type { AppState } from '../../state/store-context';

export interface FollowUpSlot {
  index: number;
  /* followups row id — the handle for setDue/saveEmail. */
  id: number;
  title: string;
  iso: string;
  diff: number;
  /* "heute" / "in 9 Tagen" / "überfällig" / "Erledigt vor 15 Tagen" */
  meta: string;
  dot: string;
  kind: DotKind;
  /* How full the pie is drawn — how far the wait has run down. */
  frac: number;
  /* Ticked off as sent; the date it happened is in the row's completed_at. */
  done: boolean;
  /* Done and far-future follow-ups are de-emphasised. */
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
    /* Once it is sent, the due date stops mattering: no follow-up is overdue
       that has already gone out. */
    const done = !!f.completed_at;
    return {
      index,
      id: f.id,
      title: f.label,
      iso: f.due_at,
      diff,
      meta: done
        ? 'Erledigt ' + relLabel(dayDiff(f.completed_at!.slice(0, 10)))
        : diff === 0
          ? 'heute'
          : diff === 1
            ? 'morgen'
            : diff > 0
              ? 'in ' + diff + ' Tagen'
              : 'überfällig',
      /* One ring that fills up as the date closes in: empty and dashed while
         there is time, part-filled in amber on the day, all but full in the
         warning red once the date has passed — and a grey tick once sent. */
      dot: done
        ? 'var(--c-c9c5bb)'
        : diff < 0
          ? 'var(--c-c2564c)'
          : diff <= 1
            ? 'var(--c-d0a03f)'
            : 'var(--c-c9c5bb)',
      kind: done ? DotKind.DONE : diff <= 1 ? DotKind.PIE : DotKind.DASHED,
      /* Not a full turn: at 1 the arc closes on its own start and renders as
         nothing at all. */
      frac: diff < 0 ? 0.9 : 0.45,
      done,
      dim: done || diff > 7 ? 0.5 : 1,
      emailSubject: f.email_subject,
      emailText: f.email_text,
    };
  });
}

/* The email card's version of `meta`. It says the same thing in more words —
   an overdue follow-up is counted out in days there, where the list only marks
   it "überfällig" — so the two ladders live side by side and stay in step. */
export function dueLabel(slot: FollowUpSlot): string {
  if (slot.done) return slot.meta;
  if (slot.diff === 0) return 'heute';
  if (slot.diff === 1) return 'morgen';
  return slot.diff > 0 ? 'in ' + slot.diff + ' Tagen' : 'seit ' + -slot.diff + ' Tagen überfällig';
}

/* A sent follow-up is not late for anything, so the red urgency gives way to
   the date it went out. */
export function dueColor(slot: FollowUpSlot): string {
  if (slot.done) return 'var(--c-8b8880)';
  if (slot.diff <= 0) return 'var(--c-c2564c)';
  return slot.diff <= 2 ? 'var(--c-9a7218)' : 'var(--c-9a978f)';
}

/* A card that does not know its role yet shows the {{…}} gap the drafted email
   uses, not the app's own "Neue Bewerbung" stand-in — the label is a preview
   of that email's subject, and the gap says what is still to fill in. */
function roleOrGap(role: string): string {
  return !role || role === UNKNOWN_ROLE ? '{{ROLE}}' : role;
}

/* Chip and menu label — the drafted email's subject line. Names the role in
   full: where it does not fit, the layout truncates it with a real ellipsis — a
   character budget here would cut mid-word even when there was room to spare. */
export function slotLabel(slot: FollowUpSlot, role: string): string {
  const named = roleOrGap(role);
  return slot.index === 0 ? 'Follow up zur Bewerbung als ' + named : slot.title + ': ' + named;
}

/* Kepler's drafted follow-up. Tone escalates across the sequence, and the last
   one explicitly offers to close the loop. A deterministic template of the
   card's role, company and addressee: an unsent follow-up is rendered from it
   live, so it always says what the card says now; only a sent one is frozen
   (see FollowUpEmailCard). Whatever the card does not know yet is left as a
   {{…}} gap — the same shape Kepler's document templates use — rather than
   a bare greeting or the app's own "Unbekanntes Unternehmen" placeholder,
   which is not something to send. */
export function draftEmail(
  slots: FollowUpSlot[],
  sel: number,
  rawRole: string,
  rawCompany: string,
  contactName: string,
) {
  const isLast = sel === slots.length - 1 && sel > 0;
  const greeting = 'Hallo ' + (contactName ? contactName.split(' ')[0] : '{{CONTACT_PERSON}}');
  const role = roleOrGap(rawRole);
  const company = !rawCompany || rawCompany === UNKNOWN_COMPANY ? '{{COMPANY_NAME}}' : rawCompany;

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
    subject: slotLabel(slots[sel], role),
    body: greeting + ',\n\n' + body + '\n\nViele Grüße\n' + APPLICANT_NAME,
  };
}
