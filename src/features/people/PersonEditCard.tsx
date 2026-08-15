import { useRef } from 'react';
import { isoToDate, todayISO } from '../../lib/date';
import { initials } from '../../lib/text';
import { isHttpUrl } from '../../lib/url';
import { useApp } from '../../state/store-context';
import { FieldChip } from '../../ui/FieldChip';
import { InlineFieldInput, LinkValueChip, TextValueChip } from '../../ui/FieldValue';
import { FIELD_GLYPH_SLOT, FieldGlyph } from '../../ui/field-glyphs';
import { PopoverAnchor } from '../../ui/Popover';
import { Avatar } from '../../ui/icons';
import { ELLIPSIS } from '../../ui/styles';
import { CompanyPopover } from '../companies/CompanyPopover';
import { RolePopover } from '../detail/properties/RolePopover';

interface FieldDef {
  label: string;
  prop: 'name' | 'role' | 'company' | 'email' | 'phone' | 'linkedin';
  /* Only takes a full web address (https://…), like the sidebar's URL rows,
     and renders filled as the blue link pill that opens it. */
  url?: boolean;
  /* Picked from the company list (or typed to create one) instead of typed. */
  select?: boolean;
}

const FIELDS: FieldDef[] = [
  { label: 'Name', prop: 'name' },
  { label: 'Berufsbezeichnung', prop: 'role', select: true },
  { label: 'Unternehmen', prop: 'company', select: true },
  { label: 'Email', prop: 'email' },
  { label: 'Telefon', prop: 'phone' },
  { label: 'LinkedIn', prop: 'linkedin', url: true },
];

/* The select rows' keys in AppState.dropdown. */
const DD_KEY: Partial<Record<FieldDef['prop'], string>> = {
  company: 'person:company',
  role: 'person:role',
};
const DD_KEYS = new Set(Object.values(DD_KEY));

/* Inline person editor shown inside a popover, from a participant chip or a
   contact picker. Field edits land in `personFieldDraft` and are folded into
   `personDraft` on blur (or by savePerson when the popover is dismissed). */
export function PersonEditCard({
  personKey,
  subExtra,
  canDelete,
  onDelete,
  onDone,
}: {
  personKey: string;
  /* e.g. " · in 3 Runden" appended after the name. */
  subExtra?: string;
  canDelete: boolean;
  onDelete: () => void;
  onDone: () => void;
}) {
  const { st, set, person } = useApp();
  const draft = st.personDraft || {};
  const p = person(personKey);
  const liveName = ((st.personField === 'name' ? st.personFieldDraft : draft.name) || '').trim();
  const stored = st.people[personKey];
  /* The anchor of whichever select is open, for the click-away check. */
  const selectRef = useRef<HTMLDivElement>(null);
  const setDraft = (prop: FieldDef['prop'], value: string) =>
    set((s) => ({ personDraft: { ...s.personDraft, [prop]: value } }));
  const startEdit = (prop: FieldDef['prop'], value: string) =>
    set({ personField: prop, personFieldDraft: value, dropdown: null });

  return (
    <div
      style={{ padding: '8px 9px 9px', display: 'flex', flexDirection: 'column', gap: 11 }}
      /* The editor sits inside a popover, which the global outside-click
         handler leaves alone — so a click anywhere in here that is not on the
         company dropdown has to close that dropdown itself. */
      onMouseDownCapture={(e) => {
        if (!st.dropdown || !DD_KEYS.has(st.dropdown)) return;
        if (selectRef.current?.contains(e.target as Node)) return;
        set({ dropdown: null });
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Avatar bg={p.bg} size={26} fontSize={10}>
          {initials(liveName || '?') || '?'}
        </Avatar>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 0', minWidth: 0 }}>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--c-a5a29a)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {liveName ? liveName + (subExtra || '') : 'Person hinzufügen'}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--c-c3c0b8)', whiteSpace: 'nowrap' }}>
            {stored?.updatedAt
              ? 'Bearbeitet am ' + stored.updatedAt
              : 'Erstellt am ' + (stored?.createdAt || isoToDate(todayISO()))}
          </div>
        </div>
        <div className="pop-x" onClick={onDone}>
          ✕
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {FIELDS.map((f) => {
          const v = draft[f.prop] || '';
          const editing = st.personField === f.prop;
          const clear = v ? () => setDraft(f.prop, '') : undefined;
          const clearTitle = f.label + ' entfernen';
          let value;
          if (f.select) {
            const key = DD_KEY[f.prop]!;
            const open = st.dropdown === key;
            const pick = (name: string) => {
              setDraft(f.prop, name);
              set({ dropdown: null });
            };
            const close = () => set({ dropdown: null });
            value = (
              <PopoverAnchor style={{ marginLeft: -6, minWidth: 0 }} ref={open ? selectRef : undefined}>
                <FieldChip
                  open={open}
                  empty={!v}
                  chevron
                  gap={5}
                  onClick={() =>
                    set((s) => ({ dropdown: s.dropdown === key ? null : key, personField: null }))
                  }
                  onClear={clear}
                  clearTitle={clearTitle}
                >
                  <span style={ELLIPSIS}>{v || f.label + ' auswählen'}</span>
                </FieldChip>
                {open &&
                  (f.prop === 'company' ? (
                    <CompanyPopover value={v} onPick={pick} onClose={close} />
                  ) : (
                    <RolePopover value={v} onPick={pick} onClose={close} />
                  ))}
              </PopoverAnchor>
            );
          } else if (editing) {
            /* The field edit lands in personFieldDraft and is folded into the
               person draft on blur; an invalid URL draft is dropped — same
               rule as the sidebar's link rows. */
            value = (
              <InlineFieldInput
                value={st.personFieldDraft}
                url={f.url}
                onChange={(v2) => set({ personField: f.prop, personFieldDraft: v2 })}
                onEscape={() => set({ personField: null, personFieldDraft: '' })}
                onBlur={() =>
                  set((s) => {
                    if (s.personField !== f.prop) return {};
                    const next = (s.personFieldDraft || '').trim();
                    const keep = !f.url || !next || isHttpUrl(next);
                    return {
                      personDraft: keep ? { ...s.personDraft, [f.prop]: next } : s.personDraft,
                      personField: null,
                      personFieldDraft: '',
                    };
                  })
                }
              />
            );
          } else if (f.url && v) {
            value = <LinkValueChip value={v} onClear={clear} clearTitle={clearTitle} />;
          } else {
            value = (
              <TextValueChip
                value={v}
                empty={!v}
                onClear={clear}
                clearTitle={clearTitle}
                onClick={() => startEdit(f.prop, v)}
              />
            );
          }
          return (
            <div key={f.prop} style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
              <div
                style={{
                  width: 64 + FIELD_GLYPH_SLOT,
                  flexShrink: 0,
                  fontSize: 11.5,
                  color: 'var(--c-9a978f)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <FieldGlyph label={f.label} />
                {/* Truncates rather than pushing the value column around. */}
                <span style={ELLIPSIS} title={f.label}>
                  {f.label}
                </span>
              </div>
              {value}
            </div>
          );
        })}
      </div>

      {/* Only an existing person can be deleted. A new one that is closed
          without a name is undone by savePerson anyway. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {canDelete && (
          <div className="btn-ghost btn-bare" onClick={onDelete} title="Aus allen Bewerbungen entfernen">
            Person löschen
          </div>
        )}
        {/* Without a name there is nothing to save: a new person would be
            discarded, an existing one would keep its old name anyway. */}
        <div
          className={liveName ? 'btn-dark' : 'btn-dark disabled'}
          onClick={liveName ? onDone : undefined}
          title={liveName ? undefined : 'Name fehlt'}
        >
          Fertig
        </div>
      </div>
    </div>
  );
}
