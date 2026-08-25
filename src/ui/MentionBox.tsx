import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, Ref } from 'react';
import {
  MENTION_ATTR,
  TAIL_ATTR,
  composerCaret,
  composerOffsetOf,
  composerSelection,
  composerText,
  setComposerCaret,
} from '../lib/composer-dom';
import { splitMentions } from '../lib/mentions';
import type { Mentionable } from '../lib/mentions';
import type { DocumentKind } from '../shared/enums';
import { MentionChip } from './MentionText';

/* What a caller needs from the box it wraps. A textarea offered selectionStart
   and setSelectionRange; a contenteditable offers neither, and no caller has
   any business learning about DOM ranges — so the box hands out the same two
   operations in the offsets it already thinks in. */
export interface MentionBoxHandle {
  focus(): void;
  caret(): number;
  setCaret(offset: number): void;
}

/* How many drafts back ⌘Z can walk. The native undo stack goes with the
   textarea — React owns this DOM now, and a browser undo would restore nodes
   the next render contradicts. Comment drafts are short; this is generous. */
const HISTORY_LIMIT = 100;

interface Snapshot {
  text: string;
  caret: number;
}

/* A text box that paints @-mentions as the chips they will be once posted —
   the blue pill for a person, the paperclip and file size for a document.
   Used by the composer under a thread and by the editor on a comment already
   in it, so a draft looks the same while it is being written, while it is
   being corrected, and after it is sent.

   It is a contenteditable rather than a textarea because a textarea can only
   paint characters of uniform width. What the box MEANS is still one plain
   string: `value` in, `onChange` out, and every position in this file is an
   offset into that string. src/lib/composer-dom.ts is the only code that
   knows there are nodes involved.

   The browser is never allowed to edit the tree: every beforeinput is refused
   and re-applied to the string, so React stays the single writer and its idea
   of the DOM cannot drift from what is on screen. The one exception is an IME
   composition, which cannot be driven from the outside — that runs natively
   and is read back when it ends. */
export function MentionBox({
  value,
  onChange,
  onKeyDown,
  placeholder,
  mentionables = [],
  sizeOf,
  onCaretChange,
  autoFocus,
  style,
  ref,
}: {
  value: string;
  /* `caret` is where the box put the caret for this change — a mention
     popover reads its query from it. Handed over rather than looked up,
     because the browser was refused the edit and the DOM caret still sits
     where it was before the key. */
  onChange: (v: string, caret: number) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  placeholder?: string;
  /* Which names become chips as they are typed. The same list the thread
     renders with, so what is drafted is what will be posted. */
  mentionables?: Mentionable[];
  sizeOf?: (kind: DocumentKind) => number | null;
  /* The caret moved without the text changing — an arrow key, a click. */
  onCaretChange?: (caret: number) => void;
  autoFocus?: boolean;
  style?: CSSProperties;
  ref?: Ref<MentionBoxHandle>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  /* Where the caret belongs once React has committed the value that is on its
     way in. Null when this render was not ours to place a caret for. */
  const pendingCaret = useRef<number | null>(null);
  const composing = useRef(false);
  const focused = useRef(false);
  /* The handlers are attached to the node once, so they read the live value
     through a ref rather than closing over a stale render's copy. */
  const latest = useRef(value);
  latest.current = value;

  const history = useRef<Snapshot[]>([{ text: value, caret: value.length }]);
  const historyAt = useRef(0);
  /* Whether the last edit was a plain typed character, which is what may be
     folded into the previous undo step rather than becoming one of its own. */
  const coalescing = useRef(false);

  /* Bumped only to rebuild the tree from `value` after something edited it
     behind React's back — see the resync in the layout effect. */
  const [generation, setGeneration] = useState(0);
  const resyncedFor = useRef<string | null>(null);

  const names = mentionables.map((m) => m.name);

  const edit = (next: string, caret: number, coalesce = false) => {
    if (coalesce && coalescing.current) {
      history.current[historyAt.current] = { text: next, caret };
    } else {
      history.current = history.current.slice(0, historyAt.current + 1);
      history.current.push({ text: next, caret });
      if (history.current.length > HISTORY_LIMIT) history.current.shift();
      historyAt.current = history.current.length - 1;
    }
    coalescing.current = coalesce;
    pendingCaret.current = caret;
    onChange(next, caret);
  };

  const step = (to: number) => {
    if (to < 0 || to >= history.current.length) return;
    historyAt.current = to;
    coalescing.current = false;
    const snap = history.current[to];
    pendingCaret.current = snap.caret;
    onChange(snap.text, snap.caret);
  };

  /* Native listener rather than React's onBeforeInput: this has to run for
     every editing intent the browser has — word deletes, drops, the undo
     shortcut — and getTargetRanges() is only on the native event. Electron is
     Chromium, so beforeinput and getTargetRanges are simply there; nothing
     here needs a fallback for a browser this app never runs in. */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const handle = (e: InputEvent) => {
      if (composing.current || e.inputType === 'insertCompositionText') return;
      const sel = composerSelection(box);
      if (!sel) return;
      const text = latest.current;
      const from = Math.min(sel.start, sel.end);
      const to = Math.max(sel.start, sel.end);

      const splice = (insert: string, start = from, end = to, coalesce = false) => {
        e.preventDefault();
        edit(text.slice(0, start) + insert + text.slice(end), start + insert.length, coalesce);
      };

      /* What the browser was about to delete, in our offsets. It reports the
         whole chip for a backspace against one, which is exactly right: a
         mention is one thing to delete, not twelve characters. */
      const targeted = (): { start: number; end: number } | null => {
        const ranges = e.getTargetRanges();
        if (!ranges.length) return null;
        const a = composerOffsetOf(box, ranges[0].startContainer, ranges[0].startOffset);
        const b = composerOffsetOf(box, ranges[0].endContainer, ranges[0].endOffset);
        return { start: Math.min(a, b), end: Math.max(a, b) };
      };

      switch (e.inputType) {
        case 'insertText':
          /* One typed character folds into the previous undo step; a space or
             a break closes it, so ⌘Z walks back word by word. */
          splice(e.data ?? '', from, to, from === to && !!e.data && !/\s/.test(e.data));
          return;
        case 'insertLineBreak':
        case 'insertParagraph':
          /* A newline, never the <div> or <br> the browser would reach for —
             the string is the truth and it holds "\n". */
          splice('\n');
          return;
        case 'insertFromPaste':
        case 'insertFromDrop':
        case 'insertFromYank':
        case 'insertReplacementText':
          splice(e.dataTransfer?.getData('text/plain') ?? '');
          return;
        case 'historyUndo':
          e.preventDefault();
          step(historyAt.current - 1);
          return;
        case 'historyRedo':
          e.preventDefault();
          step(historyAt.current + 1);
          return;
        default:
          if (e.inputType.startsWith('delete')) {
            const range = targeted() ?? { start: Math.max(0, from - (from === to ? 1 : 0)), end: to };
            splice('', range.start, range.end);
            return;
          }
          /* Bold, italic, a link — the thread renders none of it, and letting
             it through would put markup in the tree that composerText would
             then read straight back out as plain text. */
          e.preventDefault();
      }
    };

    box.addEventListener('beforeinput', handle);
    return () => box.removeEventListener('beforeinput', handle);
    /* Rebound after a resync, since that replaces the node the listener is on. */
  }, [generation]);

  /* An arrow key or a click moves the caret without changing the text, and a
     mention popover has to see it. selectionchange is the only event that
     covers both without guessing at key codes. */
  useEffect(() => {
    if (!onCaretChange) return;
    const onSelect = () => {
      const box = boxRef.current;
      if (!box || !focused.current || composing.current) return;
      const at = composerCaret(box);
      if (at != null) onCaretChange(at);
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [onCaretChange]);

  useEffect(() => {
    if (!autoFocus) return;
    const box = boxRef.current;
    if (!box) return;
    focused.current = true;
    box.focus();
    /* Editing an existing comment starts at its end, where a textarea with
       autoFocus would have put it. */
    setComposerCaret(box, latest.current.length);
    /* Once, on mount: re-running would drag the caret back to the end mid-edit. */
  }, [autoFocus]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || composing.current) return;
    if (composerText(box) !== value) {
      /* React writes whole text nodes, so an ordinary commit converges even
         though the browser was refused every edit. A composition that ended
         mid-word, or an edit no beforeinput announced, can still leave the
         tree saying something else — rebuilding it from `value` is the only
         honest recovery. Once per value, so a disagreement this cannot fix
         degrades to a stale box rather than a render loop. */
      if (resyncedFor.current !== value) {
        resyncedFor.current = value;
        setGeneration((g) => g + 1);
      }
      return;
    }
    const want = pendingCaret.current;
    if (want == null) return;
    pendingCaret.current = null;
    if (!focused.current) return;
    box.focus();
    setComposerCaret(box, want);
  });

  useImperativeHandle(ref, () => ({
    focus: () => boxRef.current?.focus(),
    caret: () => (boxRef.current && composerCaret(boxRef.current)) ?? latest.current.length,
    setCaret: (offset: number) => {
      pendingCaret.current = offset;
    },
  }));

  /* The same splitter the posted comment runs, so a name is a chip in the
     draft exactly when it will be a chip in the thread. */
  const parts = splitMentions(value, names).map((part, i) => {
    if (!part.mention) return part.t;
    const entry = mentionables.find((m) => '@' + m.name === part.t);
    if (!entry) return part.t;
    return (
      /* The mention rides on the wrapper, not on MentionChip: composer-dom
         reads the attribute and never looks inside, which is what makes the
         chip one thing to step over and one thing to delete. */
      <span key={i} {...{ [MENTION_ATTR]: part.t }} contentEditable={false}>
        <MentionChip entry={entry} sizeOf={sizeOf} />
      </span>
    );
  });

  return (
    <div
      key={generation}
      ref={boxRef}
      className="composer-box"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      data-placeholder={placeholder}
      onKeyDown={onKeyDown}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={() => {
        composing.current = false;
        const box = boxRef.current;
        if (!box) return;
        /* The composition wrote to the tree directly, so the tree is what
           happened. Read it back and let the value catch up. */
        const text = composerText(box);
        const at = composerCaret(box) ?? text.length;
        coalescing.current = false;
        if (text !== latest.current) edit(text, at);
      }}
      style={{
        fontSize: 12.5,
        color: 'var(--c-28261f)',
        lineHeight: 1.55,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        minHeight: 36,
        width: '100%',
        boxSizing: 'border-box',
        padding: 0,
        /* The string holds "\n"; without this the box would render one as a
           space and every draft would be a single line. */
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...style,
      }}
    >
      {parts}
      {/* A trailing newline has no line box of its own under pre-wrap, so the
          caret would have nowhere to sit on the line just opened. */}
      {value.endsWith('\n') && <br {...{ [TAIL_ATTR]: '1' }} />}
    </div>
  );
}
