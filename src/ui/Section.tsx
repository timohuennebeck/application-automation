import type { ReactNode } from 'react';
import { useApp } from '../state/store-context';
import { Chevron } from './icons';

const COLLAPSED_HEIGHT = '17px';

/* Collapsible section with a chevron header and a count, as used throughout
   the detail view. Collapsed state is persisted in localStorage. */
export function Section({
  sectionKey,
  title,
  count,
  gap = 12,
  children,
}: {
  sectionKey: string;
  title: string;
  count?: number | string;
  gap?: number;
  children: ReactNode;
}) {
  const { st, set } = useApp();
  const open = st.secOpen[sectionKey] !== false;

  const toggle = () =>
    set((s) => {
      const m = { ...s.secOpen, [sectionKey]: s.secOpen[sectionKey] === false };
      try {
        localStorage.setItem('kb-sections', JSON.stringify(m));
      } catch {
        /* ignore */
      }
      return { secOpen: m };
    });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        flexShrink: 0,
        overflow: open ? 'visible' : 'hidden',
        /* Collapsed, only the header row is left standing. */
        maxHeight: open ? 'none' : COLLAPSED_HEIGHT,
      }}
    >
      <div
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          userSelect: 'none',
          width: 'fit-content',
        }}
      >
        <Chevron
          size={10}
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 140ms ease' }}
        />
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>{title}</div>
        {/* The count only earns its brackets once there is something to count. */}
        {count !== undefined && count !== 0 && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--c-a5a29a)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            ({count})
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
