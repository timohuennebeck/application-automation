import { Board } from '../features/board/Board';
import { CardMenu } from '../features/board/CardMenu';
import { NewApplicationModal } from '../features/create/NewApplicationModal';
import { DetailView } from '../features/detail/DetailView';
import { SearchPalette } from '../features/search/SearchPalette';
import { TopBar } from '../features/shell/TopBar';
import { AppProvider } from '../state/store';
import { useApp } from '../state/store-context';

function Shell() {
  const { st } = useApp();
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative',
      background: 'var(--c-fbfaf7)', color: 'var(--c-1b1a17)', overflow: 'hidden',
    }}>
      <TopBar />
      {st.openCardId ? <DetailView /> : <Board />}
      <CardMenu />
      {st.searchOpen && <SearchPalette />}
      {st.modalOpen && <NewApplicationModal />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
