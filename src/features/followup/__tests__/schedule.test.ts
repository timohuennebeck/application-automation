import { describe, expect, it } from 'vitest';
import { DotKind } from '../../../data/config';
import { shiftISO, todayISO } from '../../../lib/date';
import type { AppState } from '../../../state/store-context';
import { followUpSlots } from '../schedule.ts';

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
