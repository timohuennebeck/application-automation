import { AgentStepKind } from '../../data/sample-data';
import type { AgentRun, AgentStep } from '../../data/sample-data';
import { clock } from '../../lib/date';
import { download } from '../../lib/download';
import { useApp } from '../../state/store-context';
import { DocGlyph, KeplerAvatar } from '../../ui/icons';

const STEP_STYLE = {
  [AgentStepKind.DONE]: {
    r: 0, fill: 'none', stroke: 'none', dash: '0', tick: 'M4.2 7.2 L6.2 9.2 L10 4.9', tickStroke: 'var(--c-2f7d49)',
    color: 'var(--c-5f5c56)', weight: 400, dotAnim: 'none', textAnim: 'none', textBg: 'none',
  },
  [AgentStepKind.RUN]: {
    r: 5.5, fill: 'none', stroke: 'var(--c-1b1a17)', dash: '2.2 2', tick: '', tickStroke: 'none',
    color: 'transparent', weight: 600, dotAnim: 'om-spin 2.4s linear infinite', textAnim: 'om-shimmer 2.4s linear infinite',
    textBg: 'linear-gradient(90deg,var(--c-a5a29a) 0%,var(--c-a5a29a) 28%,var(--c-1b1a17) 46%,var(--c-a5a29a) 64%,var(--c-a5a29a) 100%)',
  },
  [AgentStepKind.WAIT]: {
    r: 5.5, fill: 'none', stroke: 'var(--c-dcd9d1)', dash: '2.2 2', tick: '', tickStroke: 'none',
    color: 'var(--c-a5a29a)', weight: 400, dotAnim: 'none', textAnim: 'none', textBg: 'none',
  },
} as const;

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'mention' }
  | { kind: 'doc' };

/* Step labels embed `{m}` (an @-mention chip) and `{doc}` (a download chip)
   between runs of text; split on the placeholders themselves so the chips can
   be rendered inline in the right order. */
function tokenize(label: string): Token[] {
  return label
    .split(/(\{m\}|\{doc\})/)
    .filter((part) => part !== '')
    .map((part) =>
      part === '{m}' ? { kind: 'mention' as const }
        : part === '{doc}' ? { kind: 'doc' as const }
          : { kind: 'text' as const, value: part });
}

function StepRow({ step, elapsed, onDoc }: { step: AgentStep; elapsed: string; onDoc: () => void }) {
  const sy = STEP_STYLE[step.kind];
  const meta = step.kind === AgentStepKind.RUN ? 'seit ' + elapsed : step.meta;

  const textStyle = {
    fontSize: 12.5, color: sy.color, fontWeight: sy.weight, lineHeight: 1.4, whiteSpace: 'nowrap' as const,
    backgroundImage: sy.textBg, backgroundSize: '200% 100%',
    WebkitBackgroundClip: 'text' as const, backgroundClip: 'text' as const, animation: sy.textAnim,
    overflow: 'hidden', textOverflow: 'ellipsis',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <svg width="13" height="13" viewBox="0 0 14 14" style={{ flexShrink: 0, marginRight: 4, animation: sy.dotAnim }}>
        {sy.r > 0 && <circle cx="7" cy="7" r={sy.r} fill={sy.fill} stroke={sy.stroke} strokeWidth="1.6" strokeDasharray={sy.dash} />}
        {sy.tick && <path d={sy.tick} fill="none" stroke={sy.tickStroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>

      {tokenize(step.label).map((t, i) => {
        if (t.kind === 'mention') {
          return (
            <div key={i} style={{
              display: 'inline-flex', background: 'var(--c-e9eff8)', borderRadius: 4, padding: '1px 6px',
              fontSize: 11, fontWeight: 600, color: 'var(--c-3f6ea8)', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              @Timo
            </div>
          );
        }
        if (t.kind === 'doc') {
          return (
            <div key={i} className="step-doc" title="Dokument herunterladen" onClick={(e) => { e.stopPropagation(); onDoc(); }}>
              <DocGlyph width={10} height={12} strokeWidth={2.4} lineWidth={3} />
              <span>{step.doc}</span>
            </div>
          );
        }
        return <div key={i} style={{ ...textStyle, flexShrink: t.value.trim() ? undefined : 0 }}>{t.value.trim()}</div>;
      })}

      <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-a5a29a)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{meta}</div>
    </div>
  );
}

/* Kepler's live progress on a card, inside the animated running border. */
export function AgentRunPanel({ run, card }: {
  run: AgentRun;
  card: { id: string; role: string; company: string };
}) {
  const { st } = useApp();
  const doneCount = run.steps.filter((s) => s.kind === AgentStepKind.DONE).length;

  return (
    <div style={{
      borderRadius: 10,
      background: 'linear-gradient(var(--c-fff),var(--c-fff)) padding-box, conic-gradient(from var(--oa),var(--run) 0deg,color-mix(in srgb, var(--run) 22%, transparent) 34deg,transparent 50deg,transparent 322deg,color-mix(in srgb, var(--run) 60%, transparent) 360deg) border-box',
      animation: 'om-ang 2.6s linear infinite', border: '1.5px solid transparent',
      padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 1px 2px var(--s-7)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <KeplerAvatar />
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-1b1a17)' }}>Kepler arbeitet an dieser Bewerbung</div>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-8b8880)', flexShrink: 0 }}>
          Schritt {doneCount + 1} von {run.steps.length}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {run.steps.map((s, i) => (
          <StepRow
            key={i}
            step={s}
            elapsed={clock(run.started + st.tick)}
            onDoc={() => download((s.doc || '').replace('.docx', ''), card)}
          />
        ))}
      </div>
    </div>
  );
}
