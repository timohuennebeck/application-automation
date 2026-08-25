import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { Mentionable } from '../lib/mentions';
import type { DocumentKind } from '../shared/enums';
import { Composer } from './Composer';
import type { ComposerHandle, PendingAttachment } from './Composer';
import { useMentionPicker } from './useMentionPicker';

/* A Composer with @-mention autocomplete. The picker state is local, so every
   thread on the page (the card comments and each interview's notes) runs its
   own popover without them fighting over one shared key. */
export function MentionComposer({
  value,
  onChange,
  onSend,
  people: allMentionables,
  placeholder,
  onKeyDown,
  popoverWidth = 290,
  onAttach,
  attachments,
  onRemoveAttachment,
  onOpenAttachment,
  sizeOf,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  /* Everyone mentionable in this thread, already including the assistant. */
  people: Mentionable[];
  placeholder?: string;
  /* Runs for every key the mention popover did not consume. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  popoverWidth?: number;
  /* Passed straight through to Composer; the paperclip only shows with onAttach. */
  onAttach?: () => void;
  attachments?: PendingAttachment[];
  onRemoveAttachment?: (index: number) => void;
  onOpenAttachment?: (index: number) => void;
  /* A document chip's file size, so a mention being typed carries the same
     size the posted comment will show. Threads with no documents to mention
     (interview notes) leave it unset. */
  sizeOf?: (kind: DocumentKind) => number | null;
}) {
  const boxRef = useRef<ComposerHandle>(null);
  const picker = useMentionPicker({
    value,
    onChange,
    onKeyDown,
    mentionables: allMentionables,
    boxRef,
    popoverWidth,
  });

  return (
    <Composer
      ref={boxRef}
      value={value}
      placeholder={placeholder}
      onChange={picker.onChange}
      onKeyDown={picker.onKeyDown}
      onCaretChange={picker.onCaretChange}
      onSend={onSend}
      onAttach={onAttach}
      attachments={attachments}
      onRemoveAttachment={onRemoveAttachment}
      onOpenAttachment={onOpenAttachment}
      mentionables={allMentionables}
      sizeOf={sizeOf}
    >
      {/* Composer is the positioned ancestor the popover anchors to. */}
      {picker.popover}
    </Composer>
  );
}
