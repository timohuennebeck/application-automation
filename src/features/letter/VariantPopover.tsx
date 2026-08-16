import { useEffect, useRef } from 'react';
import { Check, CloseGlyph, RegenGlyph, UndoGlyph } from '../../ui/icons';
import { MenuLabel } from '../../ui/MenuItem';
import { Popover, PopoverVariant } from '../../ui/Popover';
import { SEND_CIRCLE } from '../../ui/styles';
import type { MarkAnchor, MarkPhase } from './mark';

const WIDTH = 316;
/* Keeps the popover off the edges of the letter pane it floats over. */
const EDGE = 10;

/* The label row both states share: a title, and the controls that belong to
   that state, pushed to the right. overflow is visible because those controls
   are pulled out of the label's padding box by negative margins — hidden would
   clip the top of a hover circle.

   MenuLabel's own 8px right padding is dropped: the controls on that side bring
   their own spacing, and leaving it there pushed the corner one a further 8px
   inward. */
const LABEL_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  overflow: 'visible',
  padding: '3px 2px 4px 8px',
} as const;

/* An icon button in that row. 22px rather than the 26px .icon-btn brings, so
   the row's height is set by its type and not by a hit area.

   The margins are what put the glyph where the eye expects it. Three boxes sit
   between it and the card's edge — the panel's 5px padding, the row's, and the
   4px the 22px button leaves around a 14px glyph — so left alone the glyph
   lands 12–14px in and reads as floating in the header rather than sitting in
   the corner. Climbing back out of them leaves it 7px from the top and, for the
   last button in the row, 7px from the right: square with the 10px radius. */
const ROW_BTN = { width: 22, height: 22, marginTop: -5, marginBottom: -5 } as const;
const CORNER_BTN = { ...ROW_BTN, marginRight: -4 } as const;

interface VariantPopoverProps {
  anchor: MarkAnchor;
  phase: MarkPhase;
  variants: string[];
  chosen: number | null;
  instruction: string;
  onInstruction: (v: string) => void;
  onGenerate: () => void;
  onPreview: (html: string | null) => void;
  onAccept: (index: number) => void;
  /* Puts a replaced passage back to what it said. Since every accepted
     replacement is saved at once, this is the only way back — and a better one
     than the old all-or-nothing discard: it undoes this passage, not the day. */
  onRestore: () => void;
  /* Lets the passage go, the same as clicking into the letter or pressing
     Escape. A marked passage that was never sent loses its mark; one with
     answers keeps them behind its pill. */
  onClose: () => void;
}

/* The X, always the last thing in the label row of whichever state the popover
   is in — so it is the one that sits in the corner. */
function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="icon-btn"
      title="Schließen"
      role="button"
      tabIndex={0}
      aria-label="Schließen"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClose();
      }}
      style={CORNER_BTN}
    >
      <CloseGlyph />
    </div>
  );
}

/* The Popover PANEL surface from src/ui/Popover.tsx, positioned over the letter
   rather than inside a React anchor — what it hangs off lives in another
   document, so the coordinates are handed in already translated. */
export function VariantPopover({
  anchor,
  phase,
  variants,
  chosen,
  instruction,
  onInstruction,
  onGenerate,
  onPreview,
  onAccept,
  onRestore,
  onClose,
}: VariantPopoverProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (phase === 'marked') inputRef.current?.focus();
  }, [phase]);

  return (
    /* Statically positioned, like the board's card menu: the popover inside
       positions itself against the letter pane, which is what the handed-in
       coordinates and the 100% below are measured against. */
    <div data-dd="1">
      <Popover
        variant={PopoverVariant.PANEL}
        top={anchor.top}
        left={Math.max(EDGE, anchor.left)}
        width={WIDTH}
        style={{ maxWidth: `calc(100% - ${EDGE * 2}px)` }}
      >
        {phase === 'marked' && (
          <>
            {/* Names what is about to happen. The marked passage below says
                which words; this says what Kepler will do with them. */}
            <MenuLabel style={LABEL_ROW}>
              <span style={{ flex: 1 }}>Umschreiben</span>
              <CloseButton onClose={onClose} />
            </MenuLabel>
            <Composer ref={inputRef} value={instruction} onChange={onInstruction} onSend={onGenerate} />
          </>
        )}
        {(phase === 'ready' || phase === 'done') && (
          <>
            <MenuLabel style={LABEL_ROW}>
              <span style={{ flex: 1 }}>Optionen</span>
              <div
                className="icon-btn"
                title="Neu erstellen"
                role="button"
                tabIndex={0}
                aria-label="Neu erstellen"
                onClick={onGenerate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onGenerate();
                }}
                /* Not the corner one — the X sits outside it. */
                style={ROW_BTN}
              >
                <RegenGlyph />
              </div>
              <CloseButton onClose={onClose} />
            </MenuLabel>
            {variants.map((v, i) => (
              <VariantRow
                key={i}
                index={i}
                html={v}
                selected={chosen === i}
                onEnter={() => onPreview(v)}
                onLeave={() => onPreview(null)}
                onClick={() => onAccept(i)}
              />
            ))}
            {phase === 'done' && (
              <div
                className="menu-item"
                onClick={onRestore}
                onMouseEnter={() => onPreview(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  marginTop: 1,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--c-77746d)',
                  padding: '6px 8px',
                }}
              >
                <UndoGlyph />
                Ursprüngliche Formulierung
              </div>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}

/* One suggestion, drawn as a MenuItem — the same metrics as every option list
   in the app, only wrapping to several lines instead of one. */
function VariantRow({
  index,
  html,
  selected,
  onEnter,
  onLeave,
  onClick,
}: {
  index: number;
  html: string;
  selected: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className={'menu-item' + (selected ? ' menu-item-selected' : '')}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        fontSize: 12.5,
        color: 'var(--c-28261f)',
        padding: '6px 8px',
        lineHeight: 1.5,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: 'var(--c-f1efe9)',
          color: 'var(--c-8b8880)',
          fontSize: 9.5,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 3,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {index + 1}
      </span>
      {/* The suggestion carries at most <strong>, escaped down to that by
          sanitizeInline before it ever left the main process. */}
      <span style={{ flex: 1, minWidth: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
      {/* Check draws no wrapper of its own, so the alignment lives here. */}
      {selected && (
        <span style={{ flexShrink: 0, marginTop: 3, display: 'flex' }}>
          <Check />
        </span>
      )}
    </div>
  );
}

/* The comment composer's insides, without its second border — the popover is
   already the card. The send button stays dark rather than greying out: an
   empty instruction is a valid one, it just means "try again". */
function Composer({
  ref,
  value,
  onChange,
  onSend,
}: {
  ref: React.Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <>
      {/* The frame and its ground are the field's only label — see
          .composer-field in app.css for why the tint is there as well. */}
      <div className="composer-field">
        <textarea
          ref={ref}
          value={value}
          placeholder="Kürzer und mit einem Fakt"
          aria-label="Anweisung für Kepler"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend();
          }}
          style={{
            display: 'block',
            fontSize: 12.5,
            color: 'var(--c-28261f)',
            lineHeight: 1.55,
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'transparent',
            minHeight: 34,
            width: '100%',
            boxSizing: 'border-box',
            /* Even inside the frame, where the old asymmetric padding sat the
               text against the bottom edge. */
            padding: '7px 9px',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          justifyContent: 'flex-end',
          padding: '8px 4px 2px 8px',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--c-a5a29a)', marginRight: 'auto', lineHeight: 1.4 }}>
          Sag nur, was anders werden soll — den Rest kennt Kepler.
        </div>
        <div
          onClick={onSend}
          role="button"
          tabIndex={0}
          aria-label="An Kepler schicken"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onSend();
          }}
          className="send-circle"
          style={SEND_CIRCLE}
        >
          ↑
        </div>
      </div>
    </>
  );
}
