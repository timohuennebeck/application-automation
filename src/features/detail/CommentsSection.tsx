import { DETAILS } from '../../data/sample-data';
import { KEPLER_ENTRY } from '../../lib/mentions';
import { initials } from '../../lib/text';
import { useApp } from '../../state/store-context';
import { MentionComposer } from '../../ui/MentionComposer';
import { MentionText } from '../../ui/MentionText';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { Avatar, DotsGlyph } from '../../ui/icons';

type Comment = [author: string, time: string, text: string, bg: string];

export function CommentsSection({ cardId }: { cardId: string }) {
  const { st, set, addComment, peopleForCard } = useApp();

  // Kepler is always mentionable; everyone attached to this card as well.
  const mentionable = [KEPLER_ENTRY, ...peopleForCard(cardId)];
  const names = mentionable.map((p) => p.name);

  const base: Comment[] = DETAILS[cardId]?.comments
    || [['Kepler', 'vor 2 Tagen', 'Karte aus der Stellenanzeige angelegt. Anschreiben und Lebenslauf liegen im Reiter Bewerbungsunterlagen.', 'var(--c-1b1a17)']];
  const comments = base
    .concat(st.addedComments[cardId] || [])
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => !(st.commentDeletes[cardId] || {})[i]);

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
                <MentionText text={body} names={names} />
              )}
            </div>
          </div>
        );
      })}

      <MentionComposer
        value={st.commentDraft}
        onChange={(v) => set({ commentDraft: v })}
        onSend={() => addComment(cardId, st.commentDraft)}
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
