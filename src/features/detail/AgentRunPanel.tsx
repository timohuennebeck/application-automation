import { Fragment } from 'react';
import { ago, elapsed } from '../../lib/date';
import type { AgentRunView } from '../../state/db-view';
import { INTERRUPTED_HEADLINE } from '../../shared/agent';
import type { AgentStepRow } from '../../shared/db-types';
import type { TemplateSlots, TemplateVersion } from '../../shared/domain';
import { AgentRunStatus, AgentStepKey, AgentStepStatus, TEMPLATE_TITLES } from '../../shared/enums';
import type { TemplateKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { AttachmentChip } from '../../ui/AttachmentChip';
import { LinkChip } from '../../ui/MentionText';
import { KeplerAvatar, RegenGlyph, StopGlyph } from '../../ui/icons';
import { RUN_BORDER_BG, SHIMMER_BG } from '../../ui/styles';
import { useDesktopList } from '../../ui/useDesktopList';

/* The Fassung Kepler uses for a slot — what the doc chip stands for. */
function selectedOf(templates: TemplateSlots | null, kind: TemplateKind): TemplateVersion | undefined {
  return templates?.[kind].find((v) => v.selected);
}

const STEP_STYLE = {
  [AgentStepStatus.DONE]: {
    r: 0,
    fill: 'none',
    stroke: 'none',
    dash: '0',
    tick: 'M4.2 7.2 L6.2 9.2 L10 4.9',
    tickStroke: 'var(--c-2f7d49)',
    color: 'var(--c-5f5c56)',
    weight: 400,
    dotAnim: 'none',
    textAnim: 'none',
    textBg: 'none',
  },
  [AgentStepStatus.RUN]: {
    r: 5.5,
    fill: 'none',
    stroke: 'var(--c-1b1a17)',
    dash: '2.2 2',
    tick: '',
    tickStroke: 'none',
    color: 'transparent',
    weight: 600,
    dotAnim: 'om-spin 2.4s linear infinite',
    textAnim: 'om-shimmer 2.4s linear infinite',
    textBg: SHIMMER_BG,
  },
  [AgentStepStatus.WAIT]: {
    r: 5.5,
    fill: 'none',
    stroke: 'var(--c-dcd9d1)',
    dash: '2.2 2',
    tick: '',
    tickStroke: 'none',
    color: 'var(--c-a5a29a)',
    weight: 400,
    dotAnim: 'none',
    textAnim: 'none',
    textBg: 'none',
  },
  [AgentStepStatus.ERROR]: {
    r: 5.5,
    fill: 'none',
    stroke: 'var(--c-c2564c)',
    dash: '0',
    tick: 'M7 4.2 L7 7.8 M7 9.9 L7 10.1',
    tickStroke: 'var(--c-c2564c)',
    color: 'var(--c-c2564c)',
    weight: 500,
    dotAnim: 'none',
    textAnim: 'none',
    textBg: 'none',
  },
} as const;

type Token = { kind: 'text'; value: string } | { kind: 'mention' } | { kind: 'doc' };

/* Step labels embed `{m}` (an @-mention chip) and `{doc}` (a download chip)
   between runs of text; split on the placeholders themselves so the chips can
   be rendered inline in the right order. */
/* The user's mention as the run texts show it — the same blue chip in a step
   label and in an error line. */
function MentionChip() {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--c-e9eff8)',
        borderRadius: 4,
        padding: '1px 6px',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--c-3f6ea8)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      @Timo
    </div>
  );
}

/* Error text with its {m} mention rendered as the chip; other tokens are
   plain text (errors carry no {doc}). */
function ErrorText({ text }: { text: string }) {
  return (
    <>
      {tokenize(text).map((t, i) =>
        t.kind === 'mention' ? (
          <MentionChip key={i} />
        ) : t.kind === 'text' ? (
          <span key={i}>{t.value}</span>
        ) : null,
      )}
    </>
  );
}

function tokenize(label: string): Token[] {
  return label
    .split(/(\{m\}|\{doc\})/)
    .filter((part) => part !== '')
    .map((part) =>
      part === '{m}'
        ? { kind: 'mention' as const }
        : part === '{doc}'
          ? { kind: 'doc' as const }
          : { kind: 'text' as const, value: part },
    );
}

/* 'seit 1:14' while running, 'vor 9 Min' once done — from the row's own
   timestamps, re-rendered by the store's second tick. */
function stepMeta(step: AgentStepRow): string {
  if (step.status === AgentStepStatus.RUN && step.started_at) return 'seit ' + elapsed(step.started_at);
  if (step.finished_at) return ago(step.finished_at);
  return '';
}

function StepRow({
  step,
  templates,
  link,
  onRetry,
  onStop,
}: {
  step: AgentStepRow;
  templates: TemplateSlots | null;
  /* The address the step works from — the posting URL on the fetch step,
     shown as the same blue pill a link gets in comments and properties. */
  link?: string | null;
  /* Set on the failed step of a failed run — renders the retry icon. */
  onRetry?: () => void;
  /* Set on the step the run is at while it is live — renders the stop
     square beside the timer. */
  onStop?: () => void;
}) {
  const sy = STEP_STYLE[step.status];

  const textStyle = {
    fontSize: 12.5,
    color: sy.color,
    fontWeight: sy.weight,
    lineHeight: 1.4,
    whiteSpace: 'nowrap' as const,
    backgroundImage: sy.textBg,
    backgroundSize: '200% 100%',
    WebkitBackgroundClip: 'text' as const,
    backgroundClip: 'text' as const,
    animation: sy.textAnim,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 14 14"
        style={{ flexShrink: 0, marginRight: 4, animation: sy.dotAnim }}
      >
        {sy.r > 0 && (
          <circle
            cx="7"
            cy="7"
            r={sy.r}
            fill={sy.fill}
            stroke={sy.stroke}
            strokeWidth="1.6"
            strokeDasharray={sy.dash}
          />
        )}
        {sy.tick && (
          <path
            d={sy.tick}
            fill="none"
            stroke={sy.tickStroke}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {tokenize(step.label).map((t, i) => {
        if (t.kind === 'mention') return <MentionChip key={i} />;
        if (t.kind === 'doc') {
          const doc = step.doc;
          if (!doc) return null;
          return (
            <AttachmentChip
              key={i}
              /* Falls back to the slot's own name while nothing is uploaded. */
              name={selectedOf(templates, doc)?.name ?? TEMPLATE_TITLES[doc]}
              size={selectedOf(templates, doc)?.size}
              title="Im Browser öffnen"
              // Cancel out the chip padding so it doesn't grow the step row.
              style={{ margin: '-3px 0', flexShrink: 0 }}
              onClick={(e) => {
                e.stopPropagation();
                window.desktop?.templates.open(doc);
              }}
            />
          );
        }
        return (
          <div key={i} style={{ ...textStyle, flexShrink: t.value.trim() ? undefined : 0 }}>
            {t.value.trim()}
          </div>
        );
      })}

      {link && <LinkChip url={link} style={{ flexShrink: 0 }} />}

      {onRetry ? (
        <div
          className="icon-btn"
          title="Schritt erneut ausführen"
          /* Longhand margins: marginLeft auto is what pins the icon to the row's
             right edge; the negative top/bottom keep the 26px hit area from
             growing the step row. */
          style={{ flexShrink: 0, marginLeft: 'auto', marginTop: -4, marginBottom: -4 }}
          onClick={onRetry}
        >
          <RegenGlyph />
        </div>
      ) : (
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'var(--c-a5a29a)',
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {stepMeta(step)}
        </div>
      )}

      {onStop && (
        <div
          className="icon-btn"
          title="Kepler stoppen"
          /* Same trick as the retry icon: the negative top/bottom keep the
             hit area from growing the step row. */
          style={{ flexShrink: 0, marginTop: -4, marginBottom: -4 }}
          onClick={onStop}
        >
          <StopGlyph />
        </div>
      )}
    </div>
  );
}

/* Kepler's live progress on a card, inside the animated running border. */
export function AgentRunPanel({ view }: { view: AgentRunView }) {
  // The store's tick re-renders this once a second, keeping the timers moving.
  const { st, retryAgentStep, stopAgent } = useApp();
  const { run, steps } = view;
  const postingUrl = st.applications[run.application_id]?.posting_url ?? null;
  const failed = run.status === AgentRunStatus.FAILED;
  const doneCount = steps.filter((s) => s.status === AgentStepStatus.DONE).length;
  /* The step the run is at: the one in flight, or — while still queued —
     the first one it will pick up. That step carries the stop control. */
  const live = run.status === AgentRunStatus.RUNNING || run.status === AgentRunStatus.QUEUED;
  const currentId = live
    ? (
        steps.find((s) => s.status === AgentStepStatus.RUN) ??
        steps.find((s) => s.status !== AgentStepStatus.DONE)
      )?.id
    : undefined;
  /* While queued the label is the queue headline ("Kepler wartet in der
     Warteschlange…"); once running, the header states who owns the record. */
  const heading = failed
    ? INTERRUPTED_HEADLINE
    : run.status === AgentRunStatus.QUEUED
      ? run.label
      : 'Kepler arbeitet an dieser Bewerbung';

  /* The doc chips show the profile templates as they really are on disk. A
     missing listing (still loading, no desktop) just leaves the size off. */
  const [templates] = useDesktopList<TemplateSlots>(
    () => window.desktop?.templates.list(),
    (msg) => console.error('[templates]', msg),
  );

  return (
    <div
      style={{
        borderRadius: 10,
        background: RUN_BORDER_BG,
        animation: failed ? 'none' : 'om-ang 2.6s linear infinite',
        border: failed ? '1.5px solid var(--c-eae7e0)' : '1.5px solid transparent',
        padding: '13px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: '0 1px 2px var(--s-7)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <KeplerAvatar />
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-1b1a17)' }}>{heading}</div>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-8b8880)', flexShrink: 0 }}>
          Schritt {Math.min(doneCount + 1, steps.length)} von {steps.length}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {steps.map((s) => {
          const showError = failed && s.status === AgentStepStatus.ERROR;
          return (
            <Fragment key={s.id}>
              <StepRow
                step={s}
                templates={templates}
                link={s.key === AgentStepKey.FETCH ? postingUrl : null}
                onRetry={showError ? () => retryAgentStep(run.application_id) : undefined}
                onStop={s.id === currentId ? () => stopAgent(run.application_id) : undefined}
              />
              {/* The error sits right where the run stopped, indented to the
                  step's text edge, not at the far end of the panel. */}
              {showError && (s.error || run.error) && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--c-c2564c)',
                    lineHeight: 1.45,
                    paddingLeft: 22,
                    marginTop: -5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  <ErrorText text={s.error ?? run.error ?? ''} />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
