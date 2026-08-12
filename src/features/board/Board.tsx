import { COLUMNS } from '../../data/sample-data';
import { BoardColumn } from './BoardColumn';

export function Board() {
  return (
    <div className="board-scroll" style={{
      display: 'flex', gap: 6, padding: '6px 12px 12px', flex: 1, alignItems: 'stretch',
      minWidth: 0, overflowX: 'auto', overflowY: 'hidden',
    }}>
      {COLUMNS.map((col, ci) => <BoardColumn key={col.name} col={col} ci={ci} />)}
    </div>
  );
}
