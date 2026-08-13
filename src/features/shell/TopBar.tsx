import { useApp } from '../../state/store-context';
import { ThemeGlyph } from '../../ui/icons';
import { BoardFilterBar } from '../board/BoardFilterBar';

/* Sits behind the native macOS traffic lights (titleBarStyle: hiddenInset),
   so the left padding reserves room for them and the bar itself drags the window. */
export function TopBar() {
  const { st, set, toggleTheme } = useApp();
  return (
    <div
      style={
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 3,
          padding: '7px 16px 7px 84px',
          flexShrink: 0,
          position: 'relative',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      <div className="top-btn no-drag" title="Suchen" onClick={() => set({ searchOpen: true, searchQ: '' })}>
        <div>Suchen</div>
        <div className="kbd">⌘K</div>
      </div>
      <div className="top-btn no-drag" title="Bewerbung anlegen" onClick={() => set({ modalOpen: true })}>
        <div>Bewerbung anlegen</div>
        <div className="kbd">⌘C</div>
      </div>
      <div
        className="top-btn no-drag"
        title={st.dark ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln'}
        onClick={toggleTheme}
      >
        <ThemeGlyph />
        <div>Theme wechseln</div>
        <div className="kbd">⌘T</div>
      </div>
      {/* Only the board can be filtered, so the control goes with it. */}
      {!st.openCardId && <BoardFilterBar />}
    </div>
  );
}
