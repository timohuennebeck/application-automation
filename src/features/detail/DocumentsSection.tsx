import { download } from '../../lib/download';
import { Section } from '../../ui/Section';
import { DocGlyph, DownloadGlyph } from '../../ui/icons';

const DOCS = [
  { name: 'Cover Letter', meta: 'DOCX · erstellt am 26.07.2026' },
  { name: 'Lebenslauf', meta: 'DOCX · aktualisiert am 24.07.2026' },
];

export function DocumentsSection({ card }: { card: { id: string; role: string; company: string } }) {
  return (
    <Section sectionKey="docs" title="Bewerbungsunterlagen" count={DOCS.length} gap={10}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {DOCS.map((d) => (
          <div key={d.name} className="doc-card" title="Herunterladen" onClick={() => download(d.name, card)}>
            <DocGlyph />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-1b1a17)' }}>{d.name}</div>
              <div style={{ fontSize: 11, color: 'var(--c-9a978f)' }}>{d.meta}</div>
            </div>
            <div className="doc-dl" title="Herunterladen"><DownloadGlyph /></div>
          </div>
        ))}
      </div>
    </Section>
  );
}
