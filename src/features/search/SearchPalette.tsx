import { CHANNEL_BG, COLUMNS } from '../../data/config';
import { highlight, initials } from '../../lib/text';
import { cardView } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import type { AppStore } from '../../state/store-context';
import { ColumnIcon, SearchGlyph } from '../../ui/icons';

interface Row {
  key: string;
  title: { pre: string; mid: string; post: string };
  sub: { pre: string; mid: string; post: string };
  iconText: string;
  iconBg: string;
  /* Applications carry their pipeline stage as a trailing chip. */
  stage?: number;
  onOpen: () => void;
}

function Highlighted({ parts }: { parts: { pre: string; mid: string; post: string } }) {
  return (
    <>
      {parts.pre}
      {parts.mid && <span style={{ background: 'var(--c-f7e9b8)', borderRadius: 2 }}>{parts.mid}</span>}
      {parts.post}
    </>
  );
}

/* Builds the grouped result set. Reads people through the store so newly added
   participants are findable and deleted ones disappear. */
function buildGroups(store: AppStore, q: string, open: (id: string) => void) {
  const { st, roundsFor, contactsFor, emailContactsFor, person } = store;

  const items = st.board.flatMap((ids, ci) =>
    ids.flatMap((id) => {
      const view = cardView(st, id);
      if (!view) return [];
      return [{ id, role: view.role, company: view.company, city: view.city, channel: view.channel, ci }];
    }),
  );

  const appRow = (it: (typeof items)[number]): Row => ({
    key: it.id,
    title: highlight(it.role, q),
    sub: highlight(it.company + (it.city ? ', ' + it.city : '') + ' · ' + it.id, q),
    iconText: (it.company || '?')[0],
    iconBg: CHANNEL_BG[it.channel] || 'var(--c-8b8880)',
    stage: it.ci,
    onOpen: () => open(it.id),
  });

  if (!q) {
    // Idle state: whatever is currently in play.
    const rows = items
      .filter((it) => it.ci >= 4 && it.ci <= 7)
      .slice(0, 5)
      .map(appRow);
    return { groups: rows.length ? [{ key: 'akt', label: 'Läuft gerade', rows }] : [], empty: false };
  }

  const apps = items
    .filter((it) =>
      (it.role + ' ' + it.company + ' ' + it.city + ' ' + it.id + ' ' + it.channel).toLowerCase().includes(q),
    )
    .map(appRow);

  const seenCompany = new Set<string>();
  const companies: Row[] = [];
  items.forEach((it) => {
    if (seenCompany.has(it.company)) return;
    if (!(it.company + ' ' + it.city).toLowerCase().includes(q)) return;
    seenCompany.add(it.company);
    companies.push({
      key: 'f-' + it.company,
      title: highlight(it.company, q),
      sub: highlight((it.city ? it.city + ' · ' : '') + COLUMNS[it.ci].name, q),
      iconText: (it.company || '?')[0],
      iconBg: CHANNEL_BG[it.channel] || 'var(--c-8b8880)',
      onOpen: () => open(it.id),
    });
  });

  const seenPerson = new Set<string>();
  const people: Row[] = [];
  items.forEach((it) => {
    const fromContacts = [...contactsFor(it.id), ...emailContactsFor(it.id)].map((c) => ({
      name: c.name,
      role: c.role || '',
      bg: c.bg || 'var(--c-7a5aa8)',
    }));
    const fromRounds = roundsFor(it.id)
      .flatMap((r) => r.people)
      .filter((k) => st.people[k])
      .map(person)
      .map((p) => ({ name: p.name, role: p.role, bg: p.bg }));

    [...fromContacts, ...fromRounds].forEach((p) => {
      if (!p.name || seenPerson.has(p.name)) return;
      if (!(p.name + ' ' + p.role + ' ' + it.company).toLowerCase().includes(q)) return;
      seenPerson.add(p.name);
      people.push({
        key: 'p-' + p.name,
        title: highlight(p.name, q),
        sub: highlight((p.role ? p.role + ' · ' : '') + it.company, q),
        iconText: initials(p.name),
        iconBg: p.bg,
        onOpen: () => open(it.id),
      });
    });
  });

  const groups = [
    { key: 'a', label: 'Bewerbungen', rows: apps },
    { key: 'f', label: 'Firmen', rows: companies },
    { key: 'p', label: 'Personen', rows: people },
  ].filter((g) => g.rows.length);

  return { groups, empty: groups.length === 0 };
}

/* ⌘K palette across applications, companies and people. */
export function SearchPalette() {
  const store = useApp();
  const { st, set, openCard } = store;
  const q = st.searchQ.trim().toLowerCase();

  const { groups, empty } = buildGroups(store, q, (id) => {
    set({ searchOpen: false, searchQ: '' });
    openCard(id);
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        onClick={() => set({ searchOpen: false })}
        style={{ position: 'absolute', inset: 0, background: 'var(--s-4)' }}
      />
      <div
        data-dd="search"
        style={{
          position: 'relative',
          marginTop: 92,
          width: 640,
          background: 'var(--c-fff)',
          border: '1px solid var(--c-e0ddd5)',
          borderRadius: 12,
          boxShadow: '0 24px 70px var(--s-3)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 15px 9px' }}>
          <SearchGlyph size={15} />
          <input
            value={st.searchQ}
            autoFocus
            placeholder="Bewerbung, Unternehmen oder Person"
            onChange={(e) => set({ searchQ: e.target.value })}
            style={{
              fontSize: 15,
              color: 'var(--c-1b1a17)',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              flex: 1,
              padding: 0,
            }}
          />
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--c-a8a49b)',
              background: 'var(--c-f2efe9)',
              borderRadius: 5,
              padding: '2px 6px',
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            esc
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '5px 5px 8px',
            maxHeight: 420,
            overflowY: 'auto',
          }}
        >
          {groups.map((g) => (
            <div key={g.key} style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: 'var(--c-a8a49b)',
                  padding: '9px 9px 4px',
                }}
              >
                {g.label}
              </div>
              {g.rows.map((row) => (
                <div
                  key={row.key}
                  className="search-row"
                  onClick={row.onOpen}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px' }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: row.iconBg,
                      color: 'var(--c-fff)',
                      fontSize: 11,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {row.iconText}
                  </div>
                  <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--c-1b1a17)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <Highlighted parts={row.title} />
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: 'var(--c-8b8880)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <Highlighted parts={row.sub} />
                    </div>
                  </div>
                  {row.stage !== undefined && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: COLUMNS[row.stage].tint,
                        borderRadius: 7,
                        padding: '4px 9px 4px 7px',
                        flexShrink: 0,
                      }}
                    >
                      <ColumnIcon col={COLUMNS[row.stage]} />
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: 'var(--c-28261f)',
                          lineHeight: 1.3,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {COLUMNS[row.stage].name}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {empty && (
            <div style={{ padding: '22px 9px', fontSize: 12.5, color: 'var(--c-a5a29a)' }}>
              Keine Treffer für „{st.searchQ}“
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
