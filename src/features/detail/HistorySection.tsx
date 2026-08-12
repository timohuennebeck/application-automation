import { HISTORY } from '../../data/sample-data';
import { useApp } from '../../state/store-context';
import { Section } from '../../ui/Section';
import { Avatar } from '../../ui/icons';

export function HistorySection({ cardId }: { cardId: string }) {
  const { st } = useApp();
  const entries = (HISTORY[cardId] || []).concat(st.history[cardId] || []);

  return (
    <Section sectionKey="history" title="Historie" count={entries.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {entries.map(([actor, text, time], i) => (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', minWidth: 0 }}>
            <Avatar bg={actor === 'Kepler' ? 'var(--c-1b1a17)' : 'var(--c-5b7a5e)'} size={15} fontSize={7} style={{ marginTop: 1 }}>
              {actor === 'Kepler' ? 'K' : 'Du'}
            </Avatar>
            <div style={{ fontSize: 12, color: 'var(--c-77746d)', lineHeight: 1.5, minWidth: 0, textWrap: 'pretty' }}>
              <span style={{ fontWeight: 600, color: 'var(--c-3d3a34)' }}>{actor}</span> {text}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-a5a29a)', marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>{time}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}
