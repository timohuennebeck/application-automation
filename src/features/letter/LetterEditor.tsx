import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useApp } from '../../state/store-context';
import { coverLetterFor } from '../../state/selectors';
import { LetterCrumbs, useLeaveLetter } from './LetterCrumbs';
import { useLetterSave } from './use-letter-save';
import { withEditorStyles } from './letter-styles';
import {
  GROUND_PROP,
  MARK_ATTR,
  SPANS_BLOCKS,
  STOP_ATTR,
  TAG_ATTR,
  markRange,
  serializeLetter,
  unwrapMark,
} from './mark';
import type { MarkAnchor, MarkPhase } from './mark';
import { VariantPopover } from './VariantPopover';

/* Everything one marked passage knows about itself. Several can be in flight at
   once, so none of this can live in a single set of component fields: the
   passage you are looking at and the passages Kepler is writing are not the
   same thing. Keyed by the mark span, which dies with the document. */
interface MarkState {
  phase: MarkPhase;
  variants: string[];
  chosen: number | null;
  /* What the passage said before anything was tried on it. */
  original: string;
  /* What the passage says as the letter now stands — the original until a
     suggestion is accepted, that suggestion afterwards. Held explicitly rather
     than derived from `chosen`, because a suggestion put on trial by a hover
     writes straight into the document: something has to say what the passage
     goes back to when the trial ends, and `chosen` is wiped by the next rewrite
     while the accepted text stays on screen. */
  committed: string;
  instruction: string;
  /* Names the rewrite currently in the air, so the square beside this passage
     stops this one and not its neighbours. Null when nothing is running. */
  callId: string | null;
}

const BLOCK_HINT = 'Bitte innerhalb eines Absatzes markieren.';
/* The page's own ground, resolved for whichever theme is on. The letter is a
   separate document and cannot read the app's custom properties, so the value
   is handed over rather than referenced. */
const groundColour = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--c-fbfaf7').trim() || '#fbfaf7';

/* The stop square that rides in the working tag — same glyph as the stop on a
   run step. Built as markup because it lives in the letter's document. */
const STOP_HTML =
  `<span ${STOP_ATTR} title="Abbrechen">` +
  '<svg viewBox="0 0 16 16" aria-hidden="true">' +
  '<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg></span>';

/* The letter, full size, with a popover on whatever passage has the focus.
   The document is rendered as itself in an iframe: the template brings its own
   CSS, and anything less than its own document would show the user something
   other than what the PDF will say. */
export function LetterEditor() {
  const { st, set } = useApp();
  const cardId = st.letterCardId;
  const doc = cardId ? coverLetterFor(st, cardId) : undefined;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const marksRef = useRef(new Map<HTMLElement, MarkState>());
  /* The passage the popover belongs to. Held as a ref as well because the
     letter's own listeners are installed once and would otherwise read the
     value they closed over. */
  const [focused, setFocused] = useState<HTMLElement | null>(null);
  const focusedRef = useRef<HTMLElement | null>(null);
  focusedRef.current = focused;
  /* The map is mutated in place; this is how a change to it reaches React. */
  const [, bump] = useReducer((n: number) => n + 1, 0);
  /* False once the page is gone, so an answer that lands late is dropped
     rather than written into a document that is no longer on screen. */
  const liveRef = useRef(true);

  const [source, setSource] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<MarkAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Marking across a paragraph is a thing the user can put right, not a
     failure — it says so itself instead of hiding behind "Ein Fehler ist
     aufgetreten" with the sentence in a tooltip. */
  const [hint, setHint] = useState<string | null>(null);
  /* Numbers the rewrites so each one can be stopped by name. */
  const callSeq = useRef(0);
  /* The calls this editor stopped on purpose. Their failure is the user's own
     click coming back and must not be reported — read from here rather than
     from the message, which is worded by whatever raised it. */
  const stoppedCalls = useRef(new Set<string>());
  const cardIdRef = useRef(cardId);
  cardIdRef.current = cardId;

  /* Counted off the marks rather than off the document: the phase is what the
     map holds, and every change to it already goes through patch(). A passage
     sent off twice is one rewrite in the air, not two. Replacements are not
     counted at all — they are written down as they are made, so there is no
     pile left to report. */
  let working = 0;
  for (const s of marksRef.current.values()) if (s.phase === 'working') working++;

  const leave = useLeaveLetter(working);

  /* Takes the letter down as it now stands. Handed to the save so it works from
     a string rather than a document that may be gone by the time it runs. */
  const serialize = useCallback(() => {
    const frameDoc = frameRef.current?.contentDocument;
    return frameDoc ? serializeLetter(frameDoc) : null;
  }, []);
  const { saveState, schedule } = useLetterSave(cardId, serialize, setError);

  /* Leaving the page tears down whatever Kepler still had in the air for this
     card. Every way out lands here — the buttons, the breadcrumb, Escape — so
     nothing keeps running for an answer that has nowhere left to go, and the
     slots it held come straight back. */
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      if (cardId) window.desktop?.agent.variantsStop(cardId).catch(() => undefined);
    };
  }, [cardId]);

  /* The theme was switched under the letter: hand the new ground over, so the
     page around the sheet stays the colour of the breadcrumb above it. */
  useEffect(() => {
    const root = frameRef.current?.contentDocument?.documentElement;
    root?.style.setProperty(GROUND_PROP, groundColour());
  }, [st.dark, source]);

  /* Read once per open: the file on disk is the starting point, and every
     later change lives in the iframe's DOM until it is saved back. */
  useEffect(() => {
    if (!doc?.file_path) return;
    let live = true;
    window.desktop?.documents
      .read(doc.file_path)
      .then((html) => {
        /* The sheet rides along in the source: injecting it on load meant the
           frame painted once at full width and then jumped to page width. */
        if (live) setSource(withEditorStyles(html));
      })
      .catch((err) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
    };
  }, [doc?.file_path]);

  const stateOf = (el: HTMLElement | null) => (el ? (marksRef.current.get(el) ?? null) : null);

  const patch = useCallback((el: HTMLElement, p: Partial<MarkState>) => {
    const cur = marksRef.current.get(el);
    if (cur) marksRef.current.set(el, { ...cur, ...p });
    bump();
  }, []);

  /* Positions the popover under a passage. Called on every scroll of the
     letter, so the two never drift apart. */
  const anchorTo = useCallback((el: HTMLElement | null) => {
    const frame = frameRef.current;
    if (!el || !frame) return setAnchor(null);
    const r = el.getBoundingClientRect();
    setAnchor({ left: frame.offsetLeft + r.left, top: frame.offsetTop + r.bottom + 8 });
  }, []);

  /* The little pill beside a passage: Kepler at work on it, or its answers
     waiting to be looked at. Null takes it away. */
  const setTag = useCallback((el: HTMLElement, kind: 'working' | 'ready' | null, label?: string) => {
    const next = el.nextElementSibling;
    if (next?.hasAttribute(TAG_ATTR)) next.remove();
    if (!kind) return;
    const tag = el.ownerDocument.createElement('span');
    tag.setAttribute(TAG_ATTR, kind);
    tag.innerHTML = `<i>K</i><b>${label}</b>` + (kind === 'working' ? STOP_HTML : '');
    el.after(tag);
  }, []);

  const focus = useCallback(
    (el: HTMLElement | null) => {
      setFocused(el);
      if (el) {
        /* Its answers are on screen now, so the pill has nothing left to say. */
        if (stateOf(el)?.phase === 'ready') setTag(el, null);
        requestAnimationFrame(() => anchorTo(el));
      } else {
        setAnchor(null);
      }
    },
    [anchorTo, setTag],
  );

  /* Lets go of the focused passage. One that was only being looked at goes back
     to what it said and loses its mark; one that Kepler is writing, that has
     answers waiting, or that already stands replaced keeps all of it — walking
     away is not the same as undoing. */
  const blur = useCallback(() => {
    const el = focusedRef.current;
    const state = stateOf(el);
    if (el && state) {
      /* Whatever the letter actually stands at comes back first, whichever
         phase the passage is in. A suggestion put on trial by a hover is undone
         by the pointer leaving it — but Escape needs no pointer movement, and
         the popover unmounts before onMouseLeave could fire. Without this the
         passage keeps text nobody accepted, and the next save writes it out. */
      el.innerHTML = state.committed;
      if (state.phase === 'marked') {
        unwrapMark(el);
        marksRef.current.delete(el);
      } else if (state.phase === 'ready') {
        /* Still unlooked-at: the pill comes back so it can be found again. */
        setTag(el, 'ready', `${state.variants.length} Optionen`);
      }
    }
    focus(null);
  }, [focus, setTag]);

  /* Wires the letter's own document once it has parsed: the selection handler
     and the scroll that keeps the popover in place. The marker styles are
     already in it — they came with the source. */
  const onFrameLoad = useCallback(() => {
    const frameDoc = frameRef.current?.contentDocument;
    const frameWin = frameRef.current?.contentWindow;
    if (!frameDoc || !frameWin) return;

    /* The stylesheet rides in with the source, but the ground it paints cannot:
       the token resolves in the app's document, not this one. */
    frameDoc.documentElement.style.setProperty(GROUND_PROP, groundColour());

    const onMouseUp = () => {
      const sel = frameWin.getSelection();
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
      /* A plain click lets go of whatever had the focus; the click handler
         below decides whether it also picks something else up. */
      if (text.length < 3) {
        if (focusedRef.current) blur();
        return;
      }
      /* Selecting inside an existing mark would nest one span in another. The
         click handler reopens that passage instead. */
      const range = sel!.getRangeAt(0);
      const within = range.commonAncestorContainer as Element | null;
      if (within?.parentElement?.closest?.(`[${MARK_ATTR}]`) || within?.closest?.(`[${MARK_ATTR}]`)) {
        return;
      }
      if (focusedRef.current) blur();

      const marked = markRange(frameDoc, range);
      sel!.removeAllRanges();
      if (marked === SPANS_BLOCKS) return setHint(BLOCK_HINT);
      if (!marked) return;

      setHint(null);
      setError(null);
      marksRef.current.set(marked, {
        phase: 'marked',
        variants: [],
        chosen: null,
        original: marked.innerHTML,
        committed: marked.innerHTML,
        instruction: '',
        callId: null,
      });
      focus(marked);
    };

    /* Picks a passage back up: one that already stands replaced, or one whose
       answers arrived while the user was somewhere else. */
    const onClick = (e: MouseEvent) => {
      const hit = e.target as Element | null;
      /* The square in a working tag calls off that one rewrite. */
      const stop = hit?.closest?.(`[${STOP_ATTR}]`);
      if (stop) {
        const passage = stop.closest(`[${TAG_ATTR}]`)?.previousElementSibling as HTMLElement | null;
        const callId = passage ? marksRef.current.get(passage)?.callId : null;
        if (callId && cardIdRef.current) {
          stoppedCalls.current.add(callId);
          window.desktop?.agent.variantsStop(cardIdRef.current, callId).catch(() => undefined);
        }
        return;
      }
      const pill = hit?.closest?.(`[${TAG_ATTR}='ready']`);
      const el = pill
        ? (pill.previousElementSibling as HTMLElement | null)
        : ((hit?.closest?.(`[${MARK_ATTR}='done']`) as HTMLElement | null) ?? null);
      if (!el || el === focusedRef.current || !marksRef.current.has(el)) return;
      if (focusedRef.current) blur();
      focus(el);
    };

    frameDoc.addEventListener('mouseup', onMouseUp);
    frameDoc.addEventListener('click', onClick);
    frameWin.addEventListener('scroll', () => anchorTo(focusedRef.current));
  }, [anchorTo, blur, focus]);

  /* The letter as the model should read it. The pills live in the letter's own
     document, so innerText picks them up: without this, a passage sent off
     while another is still working reads "Kepler erstellt Optionen…" as part of
     the letter. Hidden rather than cloned away — innerText needs layout, and a
     detached clone has none, which would flatten the paragraphs into one run. */
  const letterText = () => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return '';
    const tags = [...body.querySelectorAll<HTMLElement>(`[${TAG_ATTR}]`)];
    tags.forEach((t) => (t.style.display = 'none'));
    const text = body.innerText ?? '';
    tags.forEach((t) => t.style.removeProperty('display'));
    return text;
  };

  /* Sends one passage off. Several may be in the air at once, so this closes
     over the element it was started for and never touches the focus: while it
     runs, the user is free to mark and send the next one. */
  const generate = async (el: HTMLElement) => {
    if (!cardId) return;
    const state = stateOf(el);
    if (!state) return;
    const passage = el.textContent ?? '';
    /* Asking for another wording does not undo the one that already stands: a
       replaced passage goes back to being replaced, however this call ends, and
       keeps the way back to its original. Sending it to 'marked' instead would
       hand it to blur(), which unwraps a marked passage and forgets it. */
    const settled: MarkPhase = state.phase === 'done' ? 'done' : 'marked';

    const callId = String(++callSeq.current);
    patch(el, { phase: 'working', callId });
    setError(null);
    el.setAttribute(MARK_ATTR, 'working');
    setTag(el, 'working', 'Kepler erstellt Optionen…');
    /* The popover has nothing to show for a passage being written. */
    if (focusedRef.current === el) focus(null);

    let res;
    try {
      res = await window.desktop?.agent.variants({
        applicationId: cardId,
        callId,
        passage,
        letter: letterText(),
        instruction: state.instruction.trim() || null,
      });
    } finally {
      /* The passage must come back out of its working state on every path — a
         thrown call would otherwise leave it shimmering for good. */
      el.setAttribute(MARK_ATTR, settled === 'done' ? 'done' : '');
      setTag(el, null);
      patch(el, { callId: null });
    }
    if (!liveRef.current) return;

    /* Stopped from the square beside the passage: the passage simply goes back
       to where it stood. Reporting the user's own click as a failure would be
       noise. */
    if (stoppedCalls.current.delete(callId)) {
      patch(el, { phase: settled });
      if (!focusedRef.current) focus(el);
      return;
    }

    if (!res || !res.ok) {
      /* The reason goes in the header, which is visible whatever has the focus.
         The passage keeps its place and only takes the focus if nothing else
         has it — a failure must not yank the user out of the passage they moved
         on to any more than a success may. */
      setError(res?.error ?? 'Ohne Desktop-Umgebung nicht möglich.');
      patch(el, { phase: settled });
      if (!focusedRef.current) focus(el);
      else setTag(el, 'ready', 'Nochmal versuchen');
      return;
    }
    patch(el, { phase: settled === 'done' ? 'done' : 'ready', variants: res.variants, chosen: null });
    /* Nothing else has the focus, so show the answers straight away. Otherwise
       the passage keeps a pill saying they are waiting — the user is in the
       middle of another one and must not have it yanked away. */
    if (!focusedRef.current) focus(el);
    else setTag(el, 'ready', `${res.variants.length} Optionen`);
  };

  /* Puts a suggestion in the letter on trial. Nothing is decided until it is
     picked, so what the passage falls back to is wherever the letter currently
     stands — the original, or an earlier suggestion already accepted.

     innerHTML is the point here — a suggestion may carry <strong>. It is safe
     because validateVariants ran sanitizeInline on it in the main process:
     everything is escaped and only bare emphasis tags are handed back. The
     iframe carries no allow-scripts either, so markup that somehow got through
     still could not run. */
  const preview = (html: string | null) => {
    const el = focusedRef.current;
    const state = stateOf(el);
    if (!el || !state) return;
    el.innerHTML = html ?? state.committed;
  };

  const accept = (index: number) => {
    const el = focusedRef.current;
    const state = stateOf(el);
    if (!el || !state) return;
    const committed = state.variants[index];
    el.innerHTML = committed;
    el.setAttribute(MARK_ATTR, 'done');
    patch(el, { phase: 'done', chosen: index, committed });
    /* Picking closes the list, the way every SelectPopover in the app does.
       The passage stays green and clicking it opens the same three again. */
    focus(null);
    schedule();
  };

  /* Puts one passage back to what it said. This is the whole of undo now: the
     letter writes itself down, so there is no session-wide discard to fall back
     on — and undoing the passage in front of you beats undoing the afternoon.
     The suggestions stay on the table, because the reason to go back is usually
     to try a different one. */
  const restore = () => {
    const el = focusedRef.current;
    const state = stateOf(el);
    if (!el || !state) return;
    el.innerHTML = state.original;
    el.setAttribute(MARK_ATTR, '');
    patch(el, { phase: 'ready', chosen: null, committed: state.original });
    schedule();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* Escape backs out one level: the confirmation, then the popover, and the
         page only once nothing is open and nothing would be lost. The store's
         own Escape stands aside while the letter is up, so this is the whole
         chain — see the letterCardId guard in store.tsx. */
      if (st.dropdown) set({ dropdown: null });
      else if (focusedRef.current) blur();
      else leave.askOrClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!cardId || !doc) return null;

  const focusedState = stateOf(focused);

  /* A screen of its own, like the detail view — not a dialog over one. The
     breadcrumb is the way back, so the letter gets the whole window and
     editing it reads as somewhere you went rather than something covering
     what you were looking at. */
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <LetterCrumbs
        cardId={cardId}
        title={doc.title}
        working={working}
        leave={leave}
        saveState={saveState}
        error={error}
        hint={hint}
      />

      <div
        style={{
          flex: 1,
          position: 'relative',
          /* Same ground as the breadcrumb above, and no rule between them: the
             letter page is one surface, not a header over a canvas. */
          background: 'var(--c-fbfaf7)',
          minHeight: 0,
        }}
      >
        {source === null ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12.5,
              color: 'var(--c-8b8880)',
              animation: 'om-pulse 1.4s ease-in-out infinite',
            }}
          >
            Anschreiben wird geladen…
          </div>
        ) : (
          <iframe
            ref={frameRef}
            title={doc.title}
            srcDoc={source}
            onLoad={onFrameLoad}
            /* Same origin so the selection and the document are reachable;
               no allow-scripts, so a template's own scripts stay inert while
               it is being edited. */
            sandbox="allow-same-origin"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              /* The ground the letter scrolls on, not paper — the sheet paints
                 its own white inside. Matching it to the page keeps the mask
                 below from showing an edge where it fades out. */
              background: 'var(--c-fbfaf7)',
              /* The same fade the detail view puts over its scrolling column,
                 so the letter dissolves into the breadcrumb instead of sliding
                 under a hard line. The letter scrolls inside the frame, so the
                 mask belongs on the frame itself. */
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 24px)',
              maskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 24px)',
            }}
          />
        )}
        {/* Nothing floats over the letter while Kepler writes — the passage
            and its pill carry that state on their own. */}
        {anchor && focused && focusedState && (
          <VariantPopover
            anchor={anchor}
            phase={focusedState.phase}
            variants={focusedState.variants}
            chosen={focusedState.chosen}
            instruction={focusedState.instruction}
            onInstruction={(v) => patch(focused, { instruction: v })}
            onGenerate={() => generate(focused)}
            onPreview={preview}
            onAccept={accept}
            onRestore={restore}
            /* The same way out as clicking into the letter or pressing Escape:
               a passage that was only marked is let go, one with answers keeps
               them behind its pill. */
            onClose={blur}
          />
        )}
      </div>
    </div>
  );
}
