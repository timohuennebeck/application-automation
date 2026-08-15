/* The three renderers a field value cycles through — inline editor, link
   pill, text chip — shared by the sidebar's FactField and the person editor,
   which used to carry byte-identical copies. The draft state and commit
   semantics stay with the caller; only the look and the URL rule live here. */
import type { KeyboardEvent } from 'react';
import { isHttpUrl } from '../lib/url';
import { FieldChip } from './FieldChip';
import { LinkGlyph } from './icons';
import { ELLIPSIS } from './styles';

/* The inline editor a field chip turns into. A URL field only takes a full
   web address: while the draft is anything else the input turns red and
   Enter does nothing; what happens on blur (commit or drop) is the caller's
   call — it gets the validity along with the event. Sized exactly like the
   chip it replaces (font, line height, 1px border in place of the chip's
   padding), so focusing a field does not move the rows around it. */
export function InlineFieldInput({
  value,
  url,
  fill,
  onChange,
  onBlur,
  onEscape,
}: {
  value: string;
  url?: boolean;
  /* Fills the sidebar's value column instead of sizing to content. */
  fill?: boolean;
  onChange: (v: string) => void;
  onBlur: (invalid: boolean) => void;
  /* Escape is caller-specific: the sidebar arms its cancel ref and blurs,
     the person editor just drops its draft state. Propagation is already
     stopped. */
  onEscape: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const invalid = !!url && !!value.trim() && !isHttpUrl(value.trim());
  return (
    <input
      value={value}
      autoFocus
      placeholder={url ? 'https://…' : undefined}
      title={invalid ? 'Nur vollständige Links (https://…)' : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (!invalid) e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          onEscape(e);
        }
      }}
      onBlur={() => onBlur(invalid)}
      style={{
        fontSize: 12.5,
        color: 'var(--c-28261f)',
        lineHeight: 1.45,
        border: '1px solid ' + (invalid ? 'var(--c-c2564c)' : 'var(--c-cfccc3)'),
        borderRadius: 5,
        padding: '1px 5px',
        marginLeft: -6,
        background: 'var(--c-fff)',
        outline: 'none',
        flex: '1 1 0',
        ...(fill ? { width: '100%' } : null),
        minWidth: 0,
      }}
    />
  );
}

/* A filled link value is a link: the pill opens the address, the ✕ removes
   it. Editing = remove and add again. */
export function LinkValueChip({
  value,
  href,
  locked,
  onClear,
  clearTitle,
}: {
  value: string;
  /* Where the pill opens; the value itself when omitted. */
  href?: string;
  locked?: boolean;
  onClear?: () => void;
  clearTitle: string;
}) {
  return (
    <FieldChip
      link
      locked={locked}
      title={value}
      style={{ marginLeft: -6 }}
      onClear={onClear}
      clearTitle={clearTitle}
      onClick={() => window.desktop?.openExternal(href ?? value)}
    >
      <LinkGlyph />
      <span style={ELLIPSIS}>{value}</span>
    </FieldChip>
  );
}

/* A plain text value (or its "Hinzufügen" placeholder); clicking starts the
   caller's inline edit. */
export function TextValueChip({
  value,
  empty,
  locked,
  onClear,
  clearTitle,
  onClick,
}: {
  value: string;
  empty: boolean;
  locked?: boolean;
  onClear?: () => void;
  clearTitle: string;
  onClick: () => void;
}) {
  return (
    <FieldChip
      empty={empty}
      locked={locked}
      title={empty ? undefined : value}
      style={{ marginLeft: -6, cursor: locked ? 'not-allowed' : 'text' }}
      onClear={onClear}
      clearTitle={clearTitle}
      onClick={onClick}
    >
      <span style={ELLIPSIS}>{empty ? 'Hinzufügen' : value}</span>
    </FieldChip>
  );
}
