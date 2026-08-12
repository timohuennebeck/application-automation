import { useApp } from '../../state/store-context';
import { FieldChip } from '../../ui/FieldChip';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { StatusDot } from '../../ui/icons';
import { FollowUpEmailCard } from './FollowUpEmailCard';
import { followUpSlots, slotLabel } from './schedule';

/* Follow-up planning: which one is being worked on, and its drafted email. */
export function FollowUpSection({ cardId, role, company }: { cardId: string; role: string; company: string }) {
  const { st, set } = useApp();
  const slots = followUpSlots(st, cardId);
  const sel = Math.min(st.followupSel, slots.length - 1);
  const cur = slots[sel];
  const open = st.dropdown === 'followup';

  return (
    <Section sectionKey="follow" title="Follow Ups" count={slots.length}>
      <PopoverAnchor style={{ width: 'fit-content', marginLeft: -6 }}>
        <FieldChip
          open={open}
          gap={6}
          chevron
          style={{ padding: '3px 7px', opacity: cur.dim }}
          onClick={() => set((s) => ({ dropdown: s.dropdown === 'followup' ? null : 'followup' }))}
        >
          <StatusDot kind={cur.kind} accent={cur.dot} frac={0.45} size={13} />
          <span style={{ fontWeight: 600 }}>{slotLabel(cur, role)}</span>
          <span style={{ color: 'var(--c-a5a29a)' }}>· {cur.meta}</span>
        </FieldChip>
        {open && (
          <Popover top={28} minWidth={248}>
            {slots.map((s) => (
              <MenuItem
                key={s.index}
                selected={s.index === sel}
                dim={s.dim}
                onClick={() => set({ followupSel: s.index, dropdown: null })}
              >
                <StatusDot kind={s.kind} accent={s.dot} frac={0.45} size={13} />
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{slotLabel(s, role)}</span>
                <span style={{ flex: '1 1 auto' }} />
                <span style={{ fontSize: 11.5, color: 'var(--c-a5a29a)', whiteSpace: 'nowrap' }}>{s.meta}</span>
              </MenuItem>
            ))}
          </Popover>
        )}
      </PopoverAnchor>

      <FollowUpEmailCard cardId={cardId} role={role} company={company} slots={slots} sel={sel} />
    </Section>
  );
}
