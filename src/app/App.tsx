import { Board } from '../features/board/Board';
import { CardContactPicker } from '../features/board/CardContactPicker';
import { CardMenu } from '../features/board/CardMenu';
import { NewApplicationModal } from '../features/create/NewApplicationModal';
import { DetailView } from '../features/detail/DetailView';
import { ProfileModal } from '../features/profile/ProfileModal';
import { SearchPalette } from '../features/search/SearchPalette';
import { TopBar } from '../features/shell/TopBar';
import { AppProvider } from '../state/store';
import { useApp } from '../state/store-context';

function Shell() {
  const { st } = useApp();
  // One snapshot load at boot; rendering the board before it lands would
  // flash an empty pipeline.
  if (!st.loaded) {
    return (
      <div
        style={{
          height: '100vh',
          background: 'var(--c-fbfaf7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        {st.loadError && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--c-c2564c)',
              textAlign: 'center',
              maxWidth: 420,
              lineHeight: 1.6,
            }}
          >
            Die Datenbank konnte nicht geladen werden.
            <div style={{ fontSize: 11.5, color: 'var(--c-9a978f)', marginTop: 6 }}>{st.loadError}</div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'var(--c-fbfaf7)',
        color: 'var(--c-1b1a17)',
        overflow: 'hidden',
      }}
    >
      <TopBar />
      {st.openCardId ? <DetailView /> : <Board />}
      <CardMenu />
      <CardContactPicker />
      {st.searchOpen && <SearchPalette />}
      {st.modalOpen && <NewApplicationModal />}
      {st.profileOpen && <ProfileModal />}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
