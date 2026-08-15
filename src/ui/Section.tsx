import type { CSSProperties, ReactNode } from 'react';
import { useApp } from '../state/store-context';

/* Collapsible section with a chevron header and a count, as used throughout
   the detail view. Collapsed state is persisted in localStorage. */
export function Section({
  sectionKey,
  title,
  count,
  collapsedHeight = '17px',
  gap = 12,
  children,
  style,
}: {
  sectionKey: string;
  title: string;
  count?: number | string;
  collapsedHeight?: string;
  gap?: number;
  children: ReactNode;
  style?: CSSProperties;
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
        maxHeight: open ? 'none' : collapsedHeight,
        ...style,
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
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          style={{
            flexShrink: 0,
            opacity: 0.5,
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform 140ms ease',
          }}
        >
          <path
            d="M2 3.6 L5 6.6 L8 3.6"
            fill="none"
            stroke="var(--c-5f5c56)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
