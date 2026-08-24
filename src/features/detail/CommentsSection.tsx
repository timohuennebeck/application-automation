import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { KEPLER_ENTRY, USER_ENTRY } from '../../lib/mentions';
import type { Mentionable } from '../../lib/mentions';
import { Author, AUTHOR_LABEL, EditKind } from '../../shared/enums';
import type { DocumentKind } from '../../shared/enums';
import type { CommentEditRow } from '../../shared/db-types';
import { relTime } from '../../state/db-view';
import { documentEntries, documentFor, editStatus, editsForComment, editText } from '../../state/selectors';
import type { EditStatus } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import { MentionComposer } from '../../ui/MentionComposer';
import { MentionText } from '../../ui/MentionText';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { AttachmentChip } from '../../ui/AttachmentChip';
import { Avatar, DotsGlyph, RegenGlyph } from '../../ui/icons';
import { SHIMMER_BG } from '../../ui/styles';

/* The old half of a replacement or a deletion. The rule follows the text
   rather than sitting a shade lighter — a lighter rule read as a printing
   flaw rather than a decision. */
const OLD: CSSProperties = {
  color: 'var(--c-9a978f)',
  textDecoration: 'line-through',
  textDecorationColor: 'currentColor',
  textDecorationThickness: 1,
};
/* The green the editor puts on a passage that stands. Flat: it means "this
   holds now", and an underline would make it look like the marks. */
const NEW: CSSProperties = {
  fontWeight: 600,
  color: 'var(--c-1b1a17)',
  background: 'color-mix(in srgb, var(--c-4f8f6a) 12%, transparent)',
  borderRadius: 3,
  padding: '0 3px',
};
/* A replacement shows both halves and needs no sign. The other two are each
   missing a half, so each takes one — green cannot carry the difference,
   because the right half of a replacement is green too. */
const SIGN: CSSProperties = {
  color: 'var(--c-b3b0a8)',
  fontSize: 11.5,
  display: 'inline-block',
  width: 11,
};
/* Shared by every edit line, so the three shapes stay one size. */
const EDIT_LINE: CSSProperties = { fontSize: 12.5, lineHeight: 1.6 };

/* One line of Kepler's answer: the pair a replacement shows, or the single
   half a deletion or an insertion has. */
function EditLine({ edit }: { edit: CommentEditRow }) {
  if (edit.kind === EditKind.DELETE) {
    return (
      <div style={EDIT_LINE}>
        <span style={SIGN}>−</span>
        <span style={OLD}>{editText(edit.find_text)}</span>
      </div>
    );
  }
  if (edit.kind === EditKind.INSERT) {
    return (
      <div style={EDIT_LINE}>
        <span style={SIGN}>+</span>
        <span style={NEW}>{editText(edit.replace_text)}</span>
      </div>
    );
  }
  return (
    <div style={EDIT_LINE}>
      <span style={OLD}>{editText(edit.find_text)}</span>
      <span style={{ color: 'var(--c-b3b0a8)' }}> → </span>
      <span style={NEW}>{editText(edit.replace_text)}</span>
    </div>
  );
}

/* The pairs a Kepler reply carried, plus the line that says whether they
   still hold. Rendered only when editStatus found something to show. */
function EditSet({
  edits,
  status,
  onUndo,
}: {
  edits: CommentEditRow[];
  status: EditStatus;
  onUndo: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
      {edits.map((edit) => (
        <EditLine key={edit.id} edit={edit} />
      ))}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          marginTop: 8,
          fontSize: 11.5,
          color: status.applied ? 'var(--c-4f8f6a)' : 'var(--c-8b8880)',
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            flexShrink: 0,
            background: status.applied ? 'var(--c-4f8f6a)' : 'var(--c-c9c5bb)',
          }}
        />
        {status.applied ? `${status.title} und PDF aktualisiert` : 'Nichts geändert'}
        <span style={{ flex: 1 }} />
        {/* Only an applied set has anything to take back — there is no
           re-apply API, so an already-undone set gets the grey line and no
           button rather than an icon that would promise a retry it cannot
           perform. */}
        {status.applied && (
          <div
            className="icon-btn"
            title="Änderung zurücknehmen"
            style={{ flexShrink: 0, marginTop: -4, marginBottom: -4 }}
            onClick={onUndo}
          >
            <RegenGlyph />
          </div>
        )}
      </div>
    </div>
  );
}

/* Avatar, name and body — the shape of one entry in the thread. The row that
   stands in for the answer Kepler still owes borrows it, so the wait reads as
   the reply already on its way. `meta` sits beside the name (time, menu). */
function ThreadRow({ author, meta, children }: { author: Author; meta?: ReactNode; children: ReactNode }) {
  const kepler = author === Author.KEPLER;
  return (
    <div style={{ display: 'flex', gap: 9 }}>
      <Avatar
        bg={kepler ? 'var(--c-1b1a17)' : 'var(--c-5b7a5e)'}
        size={22}
        fontSize={9}
        style={{ marginTop: 1 }}
      >
        {kepler ? 'K' : AUTHOR_LABEL[author]}
      </Avatar>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>
            {AUTHOR_LABEL[author]}
          </div>
          {meta}
        </div>
        {children}
      </div>
    </div>
  );
}

export function CommentsSection({ cardId }: { cardId: string }) {
  const {
    st,
    set,
    addComment,
    updateComment,
    deleteComment,
    pickCommentAttachments,
    removeCommentAttachment,
    openStagedAttachment,
    openAttachment,
    peopleForCard,
    undoEdits,
  } = useApp();

  // Kepler is always mentionable; everyone attached to this card, plus its
  // generated documents, as well.
  const docEntries = documentEntries(st, cardId);
  const mentionable: Mentionable[] = [
    KEPLER_ENTRY,
    USER_ENTRY,
    ...peopleForCard(cardId).map((p) => ({ ...p, kind: 'person' as const })),
    ...docEntries,
  ];

  /* Sizes for a mentioned document's chip, read from disk rather than stored —
     the same call DocumentsSection makes, keyed here by kind instead of path
     so a rewritten file's size never goes stale under an old mention. */
  const [docSizes, setDocSizes] = useState<Partial<Record<DocumentKind, number | null>>>({});
  const docRows = docEntries.map((e) => documentFor(st, cardId, e.document!));
  const docPaths = docRows.map((d) => d?.file_path).filter((p): p is string => !!p);
  /* documentPaths (electron/files.ts) is deterministic — applicationId + kind +
     language, no timestamp — so a Kepler rewrite keeps the same file_path and
     only moves updated_at. Fold it into the key, or a rewrite's new size would
     never be re-fetched for as long as this component stays mounted. */
  const docSizeKey = docPaths.join(',') + '|' + docRows.map((d) => d?.updated_at).join(',');
  useEffect(() => {
    if (!docPaths.length) return;
    let live = true;
    window.desktop?.documents
      .sizes(docPaths)
      .then((list) => {
        if (!live) return;
        setDocSizes(Object.fromEntries(docEntries.map((e, i) => [e.document, list[i]])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docSizeKey]);
  const sizeOfDocument = (kind: DocumentKind): number | null => docSizes[kind] ?? null;
  const openDocument = (kind: DocumentKind) => {
    const doc = documentFor(st, cardId, kind);
    if (doc?.file_path) openAttachment(doc.file_path);
  };

  const comments = st.commentsByApp[cardId] || [];
  const ask = st.keplerAsk[cardId];

  return (
    <Section sectionKey="comments" title="Kommentare" count={comments.length} gap={14}>
      {comments.map((c) => {
        const ck = cardId + ':' + c.id;
        const editing = st.commentEditing === ck;
        const menuOpen = st.commentMenu === ck;
        const attachments = st.attachmentsByComment[String(c.id)] || [];
        const saveEdit = () => updateComment(cardId, c.id, st.commentEditDraft);
        /* Only a Kepler reply can carry an edit set — editStatus is null for
           every ordinary comment, so nothing renders below those. */
        const status = c.author === Author.KEPLER ? editStatus(st, c.id) : null;

        return (
          <ThreadRow
            key={c.id}
            author={c.author}
            meta={
              <>
                <div style={{ fontSize: 11, color: 'var(--c-a5a29a)' }}>{relTime(c.created_at)}</div>
                {/* Kepler's replies can be cleared away but not reworded —
                    editing them would put words in Kepler's mouth. */}
                {(c.author === Author.DU || c.author === Author.KEPLER) && (
                  <PopoverAnchor style={{ marginLeft: 'auto' }}>
                    <div
                      className="cmt-menu-btn"
                      title="Mehr"
                      onClick={() => set((s) => ({ commentMenu: s.commentMenu === ck ? null : ck }))}
                      style={{ background: menuOpen ? 'var(--c-eae7e0)' : 'transparent' }}
                    >
                      <DotsGlyph />
                    </div>
                    {menuOpen && (
                      <Popover top={24} right={0} minWidth={150}>
                        {c.author === Author.DU && (
                          <MenuItem
                            onClick={() =>
                              set({ commentEditing: ck, commentEditDraft: c.text, commentMenu: null })
                            }
                          >
                            Bearbeiten
                          </MenuItem>
                        )}
                        <MenuItem danger onClick={() => deleteComment(cardId, c.id)}>
                          Löschen
                        </MenuItem>
                      </Popover>
                    )}
                  </PopoverAnchor>
                )}
              </>
            }
          >
            {editing ? (
              <>
                <textarea
                  value={st.commentEditDraft}
                  autoFocus
                  onChange={(e) => set({ commentEditDraft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      set({ commentEditing: null });
                    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
                  }}
                  style={{
                    fontSize: 12.5,
                    color: 'var(--c-28261f)',
                    lineHeight: 1.6,
                    background: 'var(--c-fff)',
                    border: '1px solid var(--c-cfccc3)',
                    borderRadius: 6,
                    padding: '7px 9px',
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: 52,
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
                  <div className="btn-plain" onClick={() => set({ commentEditing: null })}>
                    Cancel
                  </div>
                  <div className="btn-dark" onClick={saveEdit}>
                    Speichern
                  </div>
                </div>
              </>
            ) : (
              c.text && (
                <MentionText
                  text={c.text}
                  mentionables={mentionable}
                  sizeOf={sizeOfDocument}
                  onOpenDocument={openDocument}
                />
              )
            )}

            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                {attachments.map((a) => (
                  <AttachmentChip
                    key={a.id}
                    name={a.name}
                    size={a.size}
                    title="Anhang öffnen"
                    style={{ marginLeft: -6 }}
                    onClick={() => openAttachment(a.file_path)}
                  />
                ))}
              </div>
            )}

            {/* A refusal (the document moved on since) lands in keplerAsk's
                error row below — undoEdits sets it, so the icon itself has
                nothing to catch. */}
            {status && (
              <EditSet
                edits={editsForComment(st, c.id)}
                status={status}
                onUndo={() => undoEdits(cardId, c.id)}
              />
            )}
          </ThreadRow>
        );
      })}

      {ask && (ask.pending || ask.error) && (
        <ThreadRow author={Author.KEPLER}>
          {/* The wait shimmers like a running step label — the same sweep the
              run panel and the board card use, so "Kepler is at work" looks
              the same wherever it shows. */}
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.6,
              width: 'fit-content',
              ...(ask.pending
                ? {
                    backgroundImage: SHIMMER_BG,
                    backgroundSize: '200% 100%',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    animation: 'om-shimmer 2.4s linear infinite',
                  }
                : { color: 'var(--c-c2564c)' }),
            }}
          >
            {ask.pending ? 'Kepler antwortet …' : ask.error}
          </div>
        </ThreadRow>
      )}

      <MentionComposer
        value={st.commentDraft}
        onChange={(v) => set({ commentDraft: v })}
        onSend={() => addComment(cardId, st.commentDraft)}
        onAttach={pickCommentAttachments}
        attachments={st.commentAttachments}
        onRemoveAttachment={removeCommentAttachment}
        onOpenAttachment={openStagedAttachment}
        people={mentionable}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            addComment(cardId, st.commentDraft);
          }
        }}
      />
    </Section>
  );
}
