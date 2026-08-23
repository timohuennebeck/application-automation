/* The document writing itself down.

   Everything that takes part in that — what is waiting to be written, the
   clock, and the one save allowed to be in flight — lives here rather than
   among the marks and the popover, which it shares nothing with. There is no
   save button: accepting a suggestion is the change, and this is what happens
   next. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/store-context';
import type { DocumentKind } from '../../shared/enums';
import type { SaveState } from './LetterCrumbs';

/* How long the document waits after a change before it writes itself down.
   Typing a sentence is one save rather than one per keystroke, and accepting
   several suggestions in a row is one save rather than five — since every save
   also re-renders the PDF, that matters. */
const SAVE_DELAY = 700;

/* `serialize` rather than the document itself: the document is taken down at the
   moment of the change, not when the timer fires, because the page may be gone
   by then and the document with it. `onProblem` is handed whatever the save had
   to report, so the header can say it — null when it went through. */
export function useDocumentSave(
  cardId: string | null,
  kind: DocumentKind,
  serialize: () => string | null,
  onProblem: (problem: string | null) => void,
): { saveState: SaveState; schedule: () => void } {
  const { saveDocument } = useApp();
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const pendingHtml = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* An afternoon of typing is one revision of the document, so the card gets
     one activity entry for the session, not one per pause. */
  const savedOnce = useRef(false);
  /* The save in progress, so the next one queues behind it instead of racing
     it. Never rejects — saveDocument reports its problem rather than throwing. */
  const saving = useRef<Promise<void>>(Promise.resolve());
  /* False once the page is gone, so a save that lands late says nothing to a
     header that is no longer on screen. */
  const live = useRef(true);
  /* Read through a ref: the callback changes on every render of the editor, and
     the flush that matters most runs from a cleanup. */
  const onProblemRef = useRef(onProblem);
  onProblemRef.current = onProblem;

  const flush = useCallback(async (): Promise<void> => {
    const html = pendingHtml.current;
    if (!html || !cardId) return;
    /* One save at a time. Each one re-renders the PDF, which takes long enough
       that accepting a second suggestion lands mid-render; the main process
       serialises the render, and chaining here keeps the newer HTML last. */
    saving.current = saving.current.then(async () => {
      pendingHtml.current = null;
      /* Claimed before the await, not after: a second flush starting while this
         one is still running would otherwise also read it as unclaimed, and the
         card would get two entries for one revision. */
      const first = !savedOnce.current;
      savedOnce.current = true;
      const problem = await saveDocument(cardId, kind, html, first);
      if (!live.current) return;
      onProblemRef.current(problem);
      setSaveState('saved');
    });
    return saving.current;
  }, [cardId, kind, saveDocument]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  /* Takes down what the document says right now and starts the clock. */
  const schedule = useCallback(() => {
    const html = serialize();
    if (html === null) return;
    pendingHtml.current = html;
    setSaveState('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY);
  }, [serialize]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      /* The timer dies with the page; what it was waiting to write must not. */
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flushRef.current();
    };
  }, [cardId]);

  return { saveState, schedule };
}
