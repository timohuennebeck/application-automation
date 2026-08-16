/* The chrome above the letter: where you are, the way back, and whether what
   you changed has been written down yet.

   It sits apart from the editor because it shares nothing with it — no marks,
   no selection, no calls in the air. All it needs to know is how many rewrites
   are still running, because that is the one thing leaving would throw away. */
import { useCallback, useEffect } from 'react';
import { useApp } from '../../state/store-context';
import { Popover, PopoverAnchor, PopoverVariant } from '../../ui/Popover';
import { CRUMB_LEAF, CRUMB_MUTED, CRUMB_ROW } from '../../ui/styles';

/* Keyed into the store's single open dropdown, so the confirmation is closed by
   the same global click and Escape handling as every other popover. */
const CLOSE_KEY = 'letter-close';

/* What the header reports where the save button used to be. */
export type SaveState = 'clean' | 'pending' | 'saved';

export interface LeaveLetter {
  close: () => void;
  askOrClose: () => void;
  confirmOpen: boolean;
  warning: string;
}

/* Leaving the letter, in the one place that decides it. Replacements are
   written down on their own, so walking away costs nothing — except a rewrite
   still in the air, which dies with the page. That is the only thing left worth
   a question, and the breadcrumb and Escape have to answer it the same way. */
export function useLeaveLetter(working: number): LeaveLetter {
  const { st, set } = useApp();
  const close = useCallback(() => set({ letterCardId: null, dropdown: null }), [set]);
  const dropdown = st.dropdown;
  const askOrClose = useCallback(() => {
    if (working) set({ dropdown: dropdown === CLOSE_KEY ? null : CLOSE_KEY });
    else close();
  }, [working, dropdown, set, close]);

  /* The last rewrite landed while the question was on screen, so the thing it
     warned about is no longer at stake — it would otherwise sit there reading
     "Kepler schreibt noch an 0 Stellen." */
  useEffect(() => {
    if (!working && dropdown === CLOSE_KEY) set({ dropdown: null });
  }, [working, dropdown, set]);

  return {
    close,
    askOrClose,
    confirmOpen: dropdown === CLOSE_KEY,
    /* Names what leaving would actually cost. */
    warning:
      working === 1
        ? 'Kepler schreibt noch an einer Stelle. Dieser Vorschlag geht verloren.'
        : `Kepler schreibt noch an ${working} Stellen. Diese Vorschläge gehen verloren.`,
  };
}

interface LetterCrumbsProps {
  cardId: string;
  title: string;
  /* Rewrites still running. While there is one the way out is closed: leaving
     would throw the answer away, and the passage carries a stop of its own for
     whoever means it. */
  working: number;
  leave: LeaveLetter;
  saveState: SaveState;
  error: string | null;
  hint: string | null;
}

export function LetterCrumbs({ cardId, title, working, leave, saveState, error, hint }: LetterCrumbsProps) {
  const { set } = useApp();
  const crumb = (label: string, go: () => void) =>
    working ? (
      <div style={{ ...CRUMB_MUTED, cursor: 'default' }} title={leave.warning}>
        {label}
      </div>
    ) : (
      <div className="crumb" onClick={go}>
        {label}
      </div>
    );

  return (
    <div style={CRUMB_ROW}>
      {crumb('Bewerbungen', () => set({ openCardId: null, letterCardId: null, dropdown: null }))}
      <div style={CRUMB_MUTED}>›</div>
      {/* The question hangs off the crumb because the crumb is what raises
          it — there is no longer a close button for it to belong to. */}
      <PopoverAnchor>
        {crumb(cardId, leave.askOrClose)}
        {leave.confirmOpen && (
          <Popover variant={PopoverVariant.PANEL} top={26} left={0} width={272}>
            <div
              style={{
                fontSize: 12,
                color: 'var(--c-5f5c56)',
                lineHeight: 1.5,
                padding: '6px 8px 9px',
                textWrap: 'pretty',
              }}
            >
              {leave.warning}
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', padding: '0 3px 2px' }}>
              <div className="btn-ghost" onClick={() => set({ dropdown: null })}>
                Zurück
              </div>
              <div className="btn-dark" onClick={leave.close}>
                Verlassen
              </div>
            </div>
          </Popover>
        )}
      </PopoverAnchor>
      <div style={CRUMB_MUTED}>›</div>
      <div style={CRUMB_LEAF}>{title}</div>

      <HeaderState state={saveState} error={error} hint={hint} />
    </div>
  );
}

/* What the header says where the save button used to be. The letter writes
   itself down as it is edited, so the only thing left to report is whether that
   has happened yet — and in the state it is in when the page opens, not even
   that. */
function HeaderState({
  state,
  error,
  hint,
}: {
  state: SaveState;
  error: string | null;
  hint: string | null;
}) {
  /* A hint outranks the save state: it answers something the user just tried,
     while "Gespeichert" is only ever background. */
  if (!error && !hint && state === 'clean') return null;
  const saving = !error && state === 'pending';
  const dot = error ? 'var(--c-c2564c)' : saving ? 'var(--c-c9c5bb)' : 'var(--c-4f8f6a)';
  return (
    <div
      /* An error's reason is worded by whatever raised it and is rarely
         something the user can act on — it belongs in the tooltip, not in the
         header. A hint is the opposite: it is the one thing worth reading. */
      title={error ?? undefined}
      style={{
        marginLeft: 'auto',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: error ? 'var(--c-c2564c)' : 'var(--c-9a978f)',
      }}
    >
      {!hint && <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot }} />}
      {hint ?? (error ? 'Ein Fehler ist aufgetreten' : saving ? 'Speichert…' : 'Gespeichert')}
    </div>
  );
}
