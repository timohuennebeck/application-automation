import { isoToDate } from '../../lib/date';
import { download } from '../../lib/download';
import { useApp } from '../../state/store-context';
import { Section } from '../../ui/Section';
import { DocGlyph, DownloadGlyph } from '../../ui/icons';

export function DocumentsSection({ card }: { card: { id: string; role: string; company: string } }) {
  const { st } = useApp();
  const docs = st.documentsByApp[card.id] || [];
  if (!docs.length) return null;

  const caption = (d: (typeof docs)[number]) => {
    const updated = d.updated_at > d.created_at;
    const day = isoToDate((updated ? d.updated_at : d.created_at).slice(0, 10));
    return d.format.toUpperCase() + ' · ' + (updated ? 'aktualisiert am ' : 'erstellt am ') + day;
  };

  return (
    <Section sectionKey="docs" title="Bewerbungsunterlagen" count={docs.length} gap={10}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {docs.map((d) => (
          <div key={d.id} className="doc-card" title="Herunterladen" onClick={() => download(d.title, card)}>
            <DocGlyph />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-1b1a17)' }}>{d.title}</div>
              <div style={{ fontSize: 11, color: 'var(--c-9a978f)' }}>{caption(d)}</div>
            </div>
            <div className="doc-dl" title="Herunterladen">
              <DownloadGlyph />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
