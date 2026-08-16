import type { ReactNode } from 'react';
import { KEPLER_ENTRY, USER_ENTRY } from '../../lib/mentions';
import { Author, AUTHOR_LABEL } from '../../shared/enums';
import { relTime } from '../../state/db-view';
import { useApp } from '../../state/store-context';
import { MentionComposer } from '../../ui/MentionComposer';
import { MentionText } from '../../ui/MentionText';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { AttachmentChip } from '../../ui/AttachmentChip';
import { Avatar, DotsGlyph } from '../../ui/icons';
import { SHIMMER_BG } from '../../ui/styles';

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
  } = useApp();

  // Kepler is always mentionable; everyone attached to this card as well.
  const mentionable = [KEPLER_ENTRY, USER_ENTRY, ...peopleForCard(cardId)];
  const names = mentionable.map((p) => p.name);

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
              c.text && <MentionText text={c.text} names={names} />
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
