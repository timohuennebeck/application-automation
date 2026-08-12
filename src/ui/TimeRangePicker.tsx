import { fmtMins, minsOf, timeRange } from '../lib/date';
import { Popover } from './Popover';

export interface TimeRangePickerProps {
  /* Current value, e.g. "10:00 – 11:00". */
  value: string;
  /* Which end is being picked. Held by the caller so it survives re-renders. */
  step: 'start' | 'end';
  startOverride: string | null;
  onSetStep: (step: 'start' | 'end', start: string | null) => void;
  /* `done` is true once both ends are chosen, so the caller can close. */
  onChange: (value: string, done: boolean) => void;
  /* Hide slots already past, when the chosen date is today. */
  hidePastForToday?: boolean;
}

const SlotGrid = ({ slots, current, onPick }: {
  slots: string[]; current: string; onPick: (t: string) => void;
}) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 3 }}>
    {slots.map((t) => (
      <div key={t} className={'slot' + (t === current ? ' selected' : '')} onClick={() => onPick(t)}>{t}</div>
    ))}
  </div>
);

const GroupLabel = ({ children, top = 0 }: { children: string; top?: number }) => (
  <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--c-a8a49b)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: top + 'px 2px 6px' }}>
    {children}
  </div>
);

/* Von/Bis picker: half-hour start slots, then 15-minute end slots capped at
   five hours after the start. */
export function TimeRangePicker({ value, step, startOverride, onSetStep, onChange, hidePastForToday }: TimeRangePickerProps) {
  const parts = (value || '').split('–').map((x) => x.trim());
  const curStart = startOverride || (parts[0] || '').slice(0, 5);
  const curEnd = (parts[1] || '').slice(0, 5);
  const pickingEnd = step === 'end' && !!curStart;

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const futureSlot = (t: string) => !hidePastForToday || minsOf(t) > nowMin;

  const pickStart = (label: string) => {
    const keepEnd = curEnd && minsOf(curEnd) > minsOf(label);
    onChange(label + ' – ' + (keepEnd ? curEnd : fmtMins(minsOf(label) + 60)), false);
    onSetStep('end', label);
  };
  const pickEnd = (label: string) => {
    onChange(curStart + ' – ' + label, true);
    onSetStep('start', null);
  };

  const endTimes: string[] = [];
  if (curStart) {
    for (let m = minsOf(curStart) + 15; m <= Math.min(minsOf(curStart) + 300, 22 * 60); m += 15) endTimes.push(fmtMins(m));
  }

  const end = (label: string, v: string, active: boolean, onClick: () => void) => (
    <div
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', gap: 1,
        background: active ? 'var(--c-e7e4dc)' : 'var(--c-f6f5f1)',
        borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--c-a8a49b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 12, color: v ? 'var(--c-28261f)' : 'var(--c-a5a29a)' }}>{v || '—'}</span>
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 0 9px' }}>
        {end('Von', curStart, !pickingEnd, () => onSetStep('start', null))}
        {end('Bis', curEnd, pickingEnd, () => { if (curStart) onSetStep('end', curStart); })}
      </div>
      {pickingEnd ? (
        <>
          <GroupLabel>Ende</GroupLabel>
          <div style={{ maxHeight: 150, overflow: 'auto' }}>
            <SlotGrid slots={endTimes} current={curEnd} onPick={pickEnd} />
          </div>
        </>
      ) : (
        <>
          <GroupLabel>Vormittag</GroupLabel>
          <SlotGrid slots={timeRange(8, 11.5).filter(futureSlot)} current={curStart} onPick={pickStart} />
          <GroupLabel top={11}>Nachmittag</GroupLabel>
          <SlotGrid slots={timeRange(12, 20).filter(futureSlot)} current={curStart} onPick={pickStart} />
        </>
      )}
    </>
  );
}

/* Time picker in its standard 222px popover shell. */
export function TimeRangePopover({ top = 26, left = 0, zIndex = 40, ...picker }: TimeRangePickerProps & {
  top?: number; left?: number; zIndex?: number;
}) {
  return (
    <Popover top={top} left={left} zIndex={zIndex} width={222} padding={10} stack={false}>
      <TimeRangePicker {...picker} />
    </Popover>
  );
}
