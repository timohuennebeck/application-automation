import { isoToDate, todayISO } from '../../lib/date';
import { Author, AUTHOR_LABEL } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { Section } from '../../ui/Section';
import { Avatar } from '../../ui/icons';

/* 'DD.MM.' like the prototype's history column; today's entries read as live. */
function actTime(createdAt: string): string {
  const day = createdAt.slice(0, 10);
  return day === todayISO() ? 'gerade eben' : isoToDate(day).slice(0, 6);
}

export function HistorySection({ cardId }: { cardId: string }) {
  const { st } = useApp();
  const entries = st.activitiesByApp[cardId] || [];

  return (
    <Section sectionKey="history" title="Historie" count={entries.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {entries.map((a) => (
          <div key={a.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', minWidth: 0 }}>
            <Avatar bg={a.author === Author.KEPLER ? 'var(--c-1b1a17)' : 'var(--c-5b7a5e)'} size={15} fontSize={7} style={{ marginTop: 1 }}>
              {a.author === Author.KEPLER ? 'K' : 'Du'}
            </Avatar>
            <div style={{ fontSize: 12, color: 'var(--c-77746d)', lineHeight: 1.5, minWidth: 0, textWrap: 'pretty' }}>
              <span style={{ fontWeight: 600, color: 'var(--c-3d3a34)' }}>{AUTHOR_LABEL[a.author]}</span> {a.text}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-a5a29a)', marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>{actTime(a.created_at)}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}
