import type { ReactNode } from 'react';

/* The 660px centred dialog shared by "Bewerbung anlegen" and the interview
   editor: scrim, card, scrolling body and a footer that hosts the primary action. */
export function ModalShell({
  onClose,
  header,
  footer,
  children,
}: {
  onClose: () => void;
  header: ReactNode;
  /* Omitted by dialogs that save as you go and have nothing to confirm. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--s-5)' }} />
      <div
        style={{
          position: 'relative',
          width: 660,
          maxHeight: 'calc(100% - 48px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--c-fff)',
          borderRadius: 14,
          boxShadow: '0 24px 70px var(--s-2)',
        }}
      >
        <div
          className="no-scrollbar"
          style={{
            padding: '20px 24px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {header}
            <div className="modal-x" onClick={onClose}>
              ✕
            </div>
          </div>
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: '12px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* Dark primary button with the ⌘↵ hint, as used in both dialog footers. */
export function SubmitButton({
  label,
  enabled = true,
  onClick,
}: {
  label: string;
  enabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={() => {
        if (enabled) onClick();
      }}
      style={{
        background: enabled ? 'var(--c-1b1a17)' : 'var(--c-dedbd3)',
        color: enabled ? 'var(--c-fff)' : 'var(--c-a5a29a)',
        borderRadius: 8,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13.5,
        fontWeight: 600,
        cursor: enabled ? 'pointer' : 'not-allowed',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          background: 'var(--s-6)',
          borderRadius: 4,
          padding: '1px 5px',
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        ⌘
      </span>
      <span
        style={{
          background: 'var(--s-6)',
          borderRadius: 4,
          padding: '1px 5px',
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        ↵
      </span>
    </div>
  );
}

/* Caption under a dialog field. */
export function FieldHint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13.5, color: 'var(--c-a5a29a)', lineHeight: 1.5 }}>{children}</div>;
}

/* Small label above a dialog field group. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--c-8b8880)', fontWeight: 500 }}>{children}</div>;
}
