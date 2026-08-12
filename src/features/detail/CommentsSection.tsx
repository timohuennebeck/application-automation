import { useRef } from 'react';
import { DETAILS } from '../../data/sample-data';
import { KEPLER, applyMention, mentionQuery, splitMentions } from '../../lib/mentions';
import { initials } from '../../lib/text';
import { useApp } from '../../state/store-context';
import { Composer } from '../../ui/Composer';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { Avatar, DotsGlyph } from '../../ui/icons';

type Comment = [author: string, time: string, text: string, bg: string];

/* Comment body with @-mentions rendered as chips. */
function CommentText({ text, names }: { text: string; names: string[] }) {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--c-5f5c56)', lineHeight: 1.75, textWrap: 'pretty' }}>
      {splitMentions(text, names).map((p, i) =>
        p.mention ? (
          <span
            key={i}
            style={{
              color: 'var(--c-3f6ea8)', fontWeight: 600, background: 'var(--c-e9eff8)',
              padding: '1px 6px', borderRadius: 4, display: 'inline-block',
              lineHeight: 1.35, verticalAlign: 'baseline',
            }}
          >
            {p.t}
          </span>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </div>
  );
}

export function CommentsSection({ cardId }: { cardId: string }) {
  const { st, set, addComment, peopleForCard } = useApp();
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Kepler is always mentionable; everyone attached to this card as well.
  const mentionable = [
    { key: KEPLER, name: KEPLER, role: 'KI-Assistent', bg: 'var(--c-1b1a17)', initials: 'K' },
    ...peopleForCard(cardId),
  ];
  const names = mentionable.map((p) => p.name);

  const base: Comment[] = DETAILS[cardId]?.comments
    || [['Kepler', 'vor 2 Tagen', 'Karte aus der Stellenanzeige angelegt. Anschreiben und Lebenslauf liegen im Reiter Bewerbungsunterlagen.', 'var(--c-1b1a17)']];
  const comments = base
    .concat(st.addedComments[cardId] || [])
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => !(st.commentDeletes[cardId] || {})[i]);

  /* The mention popover is open while the caret sits in an "@query". */
  const query = st.mentionAt !== null && boxRef.current
    ? mentionQuery(st.commentDraft, boxRef.current.selectionStart ?? st.commentDraft.length)
    : null;
  const matches = query
    ? mentionable.filter((p) => p.name.toLowerCase().startsWith(query.q)).slice(0, 5)
    : [];
  const mentionOpen = !!query && matches.length > 0;

  const syncMention = (value: string, caret: number) => {
    const q = mentionQuery(value, caret);
    set({ commentDraft: value, mentionAt: q ? q.start : null, mentionIx: 0 });
  };

  const pick = (name: string) => {
    const box = boxRef.current;
    if (!box || !query) return;
    const caret = box.selectionStart ?? st.commentDraft.length;
    const next = applyMention(st.commentDraft, query, caret, name);
    set({ commentDraft: next.text, mentionAt: null, mentionIx: 0 });
    // Restore the caret after React re-renders the controlled textarea.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        set((s) => ({ mentionIx: (s.mentionIx + d + matches.length) % matches.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[st.mentionIx % matches.length].name);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        set({ mentionAt: null });
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addComment(cardId, st.commentDraft);
    }
  };

  return (
    <Section sectionKey="comments" title="Kommentare" count={comments.length} gap={14}>
      {comments.map(({ c, i }) => {
        const [author, time, text, bg] = c;
        const edits = st.commentEdits[cardId] || {};
        const body = edits[i] ?? text;
        const ck = cardId + ':' + i;
        const editing = st.commentEditing === ck;
        const menuOpen = st.commentMenu === ck;
        const saveEdit = () => set((s) => ({
          commentEdits: { ...s.commentEdits, [cardId]: { ...s.commentEdits[cardId], [i]: s.commentEditDraft } },
          commentEditing: null,
        }));

        return (
          <div key={i} style={{ display: 'flex', gap: 9 }}>
            <Avatar bg={bg} size={22} fontSize={9} style={{ marginTop: 1 }}>
              {author === 'Kepler' ? 'K' : author === 'Du' ? 'Du' : initials(author)}
            </Avatar>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>{author}</div>
                <div style={{ fontSize: 11, color: 'var(--c-a5a29a)' }}>{time}</div>
                {author === 'Du' && (
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
                        <MenuItem onClick={() => set({ commentEditing: ck, commentEditDraft: body, commentMenu: null })}>
                          Bearbeiten
                        </MenuItem>
                        <MenuItem
                          danger
                          onClick={() => set((s) => ({
                            commentDeletes: { ...s.commentDeletes, [cardId]: { ...s.commentDeletes[cardId], [i]: true } },
                            commentMenu: null,
                          }))}
                        >
                          Löschen
                        </MenuItem>
                      </Popover>
                    )}
                  </PopoverAnchor>
                )}
              </div>

              {editing ? (
                <>
                  <textarea
                    value={st.commentEditDraft}
                    autoFocus
                    onChange={(e) => set({ commentEditDraft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { e.stopPropagation(); set({ commentEditing: null }); }
                      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
                    }}
                    style={{
                      fontSize: 12.5, color: 'var(--c-28261f)', lineHeight: 1.6, background: 'var(--c-fff)',
                      border: '1px solid var(--c-cfccc3)', borderRadius: 6, padding: '7px 9px', outline: 'none',
                      resize: 'vertical', minHeight: 52, width: '100%', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
                    <div className="btn-ghost" onClick={() => set({ commentEditing: null })}>Abbrechen</div>
                    <div className="btn-dark" onClick={saveEdit}>Speichern</div>
                  </div>
                </>
              ) : (
                <CommentText text={body} names={names} />
              )}
            </div>
          </div>
        );
      })}

      <Composer
        ref={boxRef}
        value={st.commentDraft}
        onChange={(v) => syncMention(v, boxRef.current?.selectionStart ?? v.length)}
        onKeyDown={onKeyDown}
        onSend={() => addComment(cardId, st.commentDraft)}
      >
        {mentionOpen && (
          <div
            data-dd="1"
            style={{
              position: 'absolute', left: 10, bottom: '100%', marginBottom: 6, zIndex: 40, width: 290,
              background: 'var(--c-fff)', border: '1px solid var(--c-e6e3dc)', borderRadius: 9,
              boxShadow: '0 14px 34px var(--s-1)', padding: 4, display: 'flex', flexDirection: 'column', gap: 1,
            }}
          >
            {matches.map((m, i) => (
              <MenuItem
                key={m.key}
                selected={i === st.mentionIx % matches.length}
                hideCheck
                // mousedown, not click: the textarea must not blur first.
                onMouseDown={() => pick(m.name)}
              >
                <Avatar bg={m.bg} size={20} fontSize={8.5}>{m.initials}</Avatar>
                <span style={{ whiteSpace: 'nowrap' }}>{m.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--c-a5a29a)', marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50%' }}>
                  {m.role}
                </span>
              </MenuItem>
            ))}
          </div>
        )}
      </Composer>
    </Section>
  );
}
