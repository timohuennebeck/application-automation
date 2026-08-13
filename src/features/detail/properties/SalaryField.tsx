import { useEffect, useRef } from 'react';
import { SALARY_STEPS, formatSalaryRange, parseSalaryRange } from '../../../lib/salary';
import type { SalaryRange } from '../../../lib/salary';
import { useApp } from '../../../state/store-context';
import { FieldChip } from '../../../ui/FieldChip';
import { MenuItem } from '../../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../../ui/Popover';

/* Where a list opens when its end is not picked yet — scrolling up from 30k to
   a realistic figure on every first edit would become the whole interaction. */
const DEFAULT_FOCUS = 60;
const LIST_MAX_HEIGHT = 208;

/* The steps of one end. Long enough that it always opens on the picked step
   rather than at the top. */
function StepList({
  options,
  value,
  onPick,
}: {
  options: number[];
  value: number | null;
  onPick: (step: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const index = options.indexOf(value ?? DEFAULT_FOCUS);
    if (index >= 0) listRef.current?.children[index]?.scrollIntoView({ block: 'center' });
  }, [options, value]);

  return (
    <Popover minWidth={92} padding={4}>
      <div
        ref={listRef}
        className="no-scrollbar"
        style={{
          maxHeight: LIST_MAX_HEIGHT,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {options.map((step) => (
          <MenuItem key={step} selected={step === value} onClick={() => onPick(step)}>
            <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>{step}k €</span>
          </MenuItem>
        ))}
      </div>
    </Popover>
  );
}

/* The Gehalt row: two dropdowns picking the ends of the range the posting
   states. Both write the single formatted string the fact stores, so the sort
   and the board card keep reading the value they always did. */
export function SalaryField({ value, cardId, locked }: { value: string; cardId: string; locked: boolean }) {
  const { st, set, writeField } = useApp();
  const range = parseSalaryRange(value);

  const write = (next: SalaryRange) => {
    writeField(cardId, 'Gehalt', formatSalaryRange(next));
    set({ dropdown: null });
  };

  const end = (
    side: 'from' | 'to',
    placeholder: string,
    options: number[],
    onPick: (step: number) => void,
  ) => {
    const key = 'fact:Gehalt:' + side;
    const picked = range[side];
    return (
      <PopoverAnchor>
        <FieldChip
          open={st.dropdown === key}
          empty={picked === null}
          locked={locked}
          gap={5}
          onClick={() => {
            if (!locked) set((s) => ({ dropdown: s.dropdown === key ? null : key, editing: null }));
          }}
        >
          <span>{picked === null ? placeholder : picked + 'k €'}</span>
        </FieldChip>
        {st.dropdown === key && <StepList options={options} value={picked} onPick={onPick} />}
      </PopoverAnchor>
    );
  };

  const from = range.from;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: -6, flexWrap: 'wrap' }}>
      {end('from', 'von', SALARY_STEPS, (step) =>
        /* A lower end at or above the upper one would read as an empty range. */
        write({ from: step, to: range.to !== null && range.to <= step ? null : range.to }),
      )}
      <span style={{ fontSize: 12.5, color: 'var(--c-a5a29a)' }}>–</span>
      {end('to', 'bis', from === null ? SALARY_STEPS : SALARY_STEPS.filter((step) => step > from), (step) =>
        write({ ...range, to: step }),
      )}
    </div>
  );
}
