import { describe, expect, it } from 'vitest';
import { DotKind } from '../../../data/config';
import { shiftISO, todayISO } from '../../../lib/date';
import type { AppState } from '../../../state/store-context';
import { APPLICANT_NAME } from '../../../shared/applicant';
import { UNKNOWN_COMPANY, UNKNOWN_ROLE } from '../../../shared/domain';
import { draftEmail, followUpSlots, slotLabel } from '../schedule.ts';

/* An ISO date `days` away from today, so the cases below stay readable. */
const shift = (days: number) => shiftISO(todayISO(), days);

/* Each entry is a follow-up's due date in days from today, optionally with the
   day it was ticked off. */
type Slot = number | { due: number; completed: number };

function state(...slots: Slot[]): AppState {
  return {
    followupsByApp: {
      A: slots.map((slot, position) => {
        const { due, completed } = typeof slot === 'number' ? { due: slot, completed: null } : slot;
        return {
          id: position + 1,
          application_id: 'A',
          label: 'Follow up ' + (position + 1),
          due_at: shift(due),
          position,
          email_subject: null,
          email_text: null,
          generated_at: null,
          completed_at: completed === null ? null : shift(completed),
        };
      }),
    },
  } as unknown as AppState;
}

describe('followUpSlots', () => {
  it('draws an overdue follow-up as a nearly full pie in the warning red', () => {
    const [slot] = followUpSlots(state(-4), 'A');
    expect(slot.kind).toBe(DotKind.PIE);
    expect(slot.frac).toBe(0.9);
    expect(slot.dot).toBe('var(--c-c2564c)');
    expect(slot.meta).toBe('überfällig');
  });

  it('draws today and tomorrow as a part-filled amber pie', () => {
    for (const days of [0, 1]) {
      const [slot] = followUpSlots(state(days), 'A');
      expect(slot.kind).toBe(DotKind.PIE);
      expect(slot.frac).toBe(0.45);
      expect(slot.dot).toBe('var(--c-d0a03f)');
    }
  });

  it('leaves anything further out as an empty dashed ring', () => {
    const [slot] = followUpSlots(state(9), 'A');
    expect(slot.kind).toBe(DotKind.DASHED);
    expect(slot.dot).toBe('var(--c-c9c5bb)');
    expect(slot.meta).toBe('in 9 Tagen');
  });

  it('keeps an overdue follow-up at full strength and only dims the far future', () => {
    expect(followUpSlots(state(-4), 'A')[0].dim).toBe(1);
    expect(followUpSlots(state(3), 'A')[0].dim).toBe(1);
    expect(followUpSlots(state(9), 'A')[0].dim).toBe(0.5);
  });

  it('reports a ticked-off follow-up as done, however overdue it was', () => {
    const [slot] = followUpSlots(state({ due: -4, completed: -15 }), 'A');
    expect(slot.done).toBe(true);
    expect(slot.kind).toBe(DotKind.DONE);
    expect(slot.dot).toBe('var(--c-c9c5bb)');
    expect(slot.meta).toBe('Erledigt vor 15 Tagen');
  });

  it('names the day a follow-up was ticked off in words, not a count', () => {
    expect(followUpSlots(state({ due: -4, completed: 0 }), 'A')[0].meta).toBe('Erledigt heute');
    expect(followUpSlots(state({ due: -4, completed: -1 }), 'A')[0].meta).toBe('Erledigt gestern');
  });

  it('lets a done follow-up recede', () => {
    expect(followUpSlots(state({ due: -4, completed: -1 }), 'A')[0].dim).toBe(0.5);
  });

  it('orders the slots by position, whatever order the rows arrive in', () => {
    const slots = followUpSlots(state(-4, 12), 'A');
    expect(slots.map((s) => s.index)).toEqual([0, 1]);
    expect(slots.map((s) => s.kind)).toEqual([DotKind.PIE, DotKind.DASHED]);
  });
});

describe('draftEmail', () => {
  const slots = followUpSlots(state(7, 14, 30), 'A');

  it('greets the contact by first name and signs as the applicant', () => {
    const { body } = draftEmail(slots, 0, 'Designer', 'Acme', 'Nadine Wolf');
    expect(body.startsWith('Hallo Nadine,')).toBe(true);
    expect(body).toContain('bei Acme als Designer');
    expect(body.endsWith('Viele Grüße\n' + APPLICANT_NAME)).toBe(true);
  });

  /* What the card does not know yet is left as a visible gap to fill, not
     papered over with a bare "Hallo" or the app's own placeholder strings. */
  it('marks a missing contact, role and company as {{…}} placeholders', () => {
    const { subject, body } = draftEmail(slots, 0, UNKNOWN_ROLE, UNKNOWN_COMPANY, '');
    expect(body.startsWith('Hallo {{CONTACT_PERSON}},')).toBe(true);
    expect(body).toContain('bei {{COMPANY_NAME}} als {{ROLE}}');
    expect(subject).toBe('Follow up zur Bewerbung als {{ROLE}}');
    expect(draftEmail(slots, 1, '', '', '').body).toContain('als {{ROLE}} bei {{COMPANY_NAME}}');
  });
});

describe('slotLabel', () => {
  const slots = followUpSlots(state(7, 14, 30), 'A');

  it('reads as the subject line, first follow-up phrased differently', () => {
    expect(slotLabel(slots[0], 'Designer')).toBe('Follow up zur Bewerbung als Designer');
    expect(slotLabel(slots[1], 'Designer')).toBe('Follow up 2: Designer');
  });

  /* The label previews the email's subject, so it shows the same gap the
     email leaves — not the "Neue Bewerbung" stand-in a roleless card carries. */
  it('shows the {{ROLE}} gap instead of the unknown-role placeholder', () => {
    expect(slotLabel(slots[0], UNKNOWN_ROLE)).toBe('Follow up zur Bewerbung als {{ROLE}}');
    expect(slotLabel(slots[2], '')).toBe('Follow up 3: {{ROLE}}');
  });
});
