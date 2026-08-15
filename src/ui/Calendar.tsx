import { useEffect, useRef } from 'react';
import { CAL_DOWS, MONTHS_DE, shiftISO, todayISO, toISO } from '../lib/date';
import { Popover } from './Popover';

interface CalendarProps {
  selectedISO: string;
  /* First and last month rendered, as 'YYYY-MM'. */
  fromYM: string;
  toYM: string;
  isDisabled?: (iso: string) => boolean;
  onPick: (iso: string) => void;
  /* Heute / +7 Tage / +14 Tage row. */
  quick?: boolean;
}

interface MonthCells {
  ym: string;
  label: string;
  cells: { iso: string | null; n: number | '' }[];
}

function buildMonths(fromYM: string, toYM: string): MonthCells[] {
  const months: MonthCells[] = [];
  let y = +fromYM.slice(0, 4);
  let m = +fromYM.slice(5, 7);
  // Guard against a malformed range spinning forever; 40 months is well past
  // the widest span any caller asks for.
  for (let guard = 0; guard < 40; guard++) {
    const ym = y + '-' + ('0' + m).slice(-2);
    const startOff = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const nDays = new Date(y, m, 0).getDate();
    const cells: MonthCells['cells'] = [];
    for (let i = 0; i < startOff; i++) cells.push({ iso: null, n: '' });
    for (let day = 1; day <= nDays; day++) cells.push({ iso: toISO(new Date(y, m - 1, day)), n: day });
    months.push({ ym, label: MONTHS_DE[m - 1] + ' ' + y, cells });
    if (ym >= toYM) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/* Vertically scrolling month calendar, sized for a 222px popover. */
function Calendar({ selectedISO, fromYM, toYM, isDisabled, onPick, quick = true }: CalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayISO();
  const months = buildMonths(fromYM, toYM);
  const targetYM = (selectedISO || today).slice(0, 7);

  // Jump to the selected month once, when the popover opens.
  useEffect(() => {
    const el = scrollRef.current;
    const t = el?.querySelector<HTMLElement>('[data-cal-m="' + targetYM + '"]');
    if (el && t) el.scrollTop = Math.max(0, t.offsetTop - el.offsetTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quickBtn = (label: string, iso: string) => {
    const disabled = isDisabled?.(iso) ?? false;
    return (
      <div
        className={'cal-quick' + (disabled ? ' disabled' : '')}
        onClick={() => {
          if (!disabled) onPick(iso);
        }}
      >
        {label}
      </div>
    );
  };

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7,26px)',
          gap: 3,
          justifyContent: 'center',
          paddingBottom: 3,
        }}
      >
        {CAL_DOWS.map((dw) => (
          <div
            key={dw}
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              color: 'var(--c-a8a49b)',
              width: 26,
              textAlign: 'center',
              textTransform: 'uppercase',
              padding: '2px 0',
            }}
          >
            {dw}
          </div>
        ))}
      </div>
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{
          height: 216,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 22px)',
          maskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 22px)',
        }}
      >
        {months.map((mn) => (
          <div key={mn.ym} data-cal-m={mn.ym}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: 'var(--c-8a877f)',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                padding: '16px 4px 4px',
              }}
            >
              {mn.label}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7,26px)',
                gap: 3,
                justifyContent: 'center',
              }}
            >
              {mn.cells.map((c, i) => {
                if (!c.iso) return <div key={i} className="cal-day" />;
                const sel = c.iso === selectedISO;
                const disabled = isDisabled?.(c.iso) ?? false;
                return (
                  <div
                    key={i}
                    className={'cal-day' + (disabled ? '' : ' pickable') + (sel ? ' selected' : '')}
                    onClick={() => {
                      if (!disabled) onPick(c.iso!);
                    }}
                    style={{
                      color: sel ? 'var(--c-fff)' : disabled ? 'var(--c-dcd9d1)' : 'var(--c-28261f)',
                      background: sel ? 'var(--c-1b1a17)' : 'transparent',
                      boxShadow: !sel && c.iso === today ? 'inset 0 0 0 1px var(--c-cfccc3)' : 'none',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {c.n}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {quick && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {quickBtn('Heute', today)}
          {quickBtn('+7 Tage', shiftISO(today, 7))}
          {quickBtn('+14 Tage', shiftISO(today, 14))}
        </div>
      )}
    </>
  );
}

/* Calendar in its standard 222px popover shell. */
export function CalendarPopover({
  top = 26,
  left = 0,
  zIndex = 40,
  ...cal
}: CalendarProps & {
  top?: number;
  left?: number;
  zIndex?: number;
}) {
  return (
    <Popover top={top} left={left} zIndex={zIndex} width={222} padding={10} stack={false} revealOnMount>
      <Calendar {...cal} />
    </Popover>
  );
}
