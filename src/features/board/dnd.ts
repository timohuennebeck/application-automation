import type { DragEvent } from 'react';
import { isSorted } from '../../state/selectors';
import type { AppStore } from '../../state/store-context';

/* Card drag-and-drop. The board reorders live while dragging, so the card the
   user holds is always shown in the slot it would land in. */

/* Chromium's default drag image is a translucent snapshot that ignores the
   card's background and animation, so we render our own off-screen clone. */
export function makeGhost(store: AppStore, e: DragEvent) {
  try {
    clearGhost(store);
    const el = e.currentTarget as HTMLElement;
    if (!el || !e.dataTransfer.setDragImage) return;
    const r = el.getBoundingClientRect();
    const w = el.offsetWidth || r.width;
    const h = el.offsetHeight || r.height;
    const scale = w ? r.width / w : 1;
    const cs = getComputedStyle(el);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:0;left:-99999px;width:' + r.width + 'px;height:' + r.height + 'px;pointer-events:none;background:transparent;z-index:-1';
    wrap.style.font = cs.font;
    wrap.style.color = cs.color;
    wrap.style.letterSpacing = cs.letterSpacing;
    wrap.style.lineHeight = cs.lineHeight;

    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.width = w + 'px';
    clone.style.height = h + 'px';
    clone.style.margin = '0';
    clone.style.opacity = '1';
    clone.style.animation = 'none';
    clone.style.boxSizing = 'border-box';
    clone.style.transformOrigin = 'top left';
    clone.style.transform = 'scale(' + scale + ')';
    clone.style.background = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#fff' : cs.backgroundColor;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      clone.style.backgroundImage = cs.backgroundImage;
      clone.style.backgroundSize = cs.backgroundSize;
      clone.style.backgroundPosition = cs.backgroundPosition;
    }
    clone.style.border = cs.border;
    clone.style.borderRadius = cs.borderRadius;
    clone.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';

    wrap.appendChild(clone);
    (el.parentNode || document.body).appendChild(wrap);
    store.ghostRef.current = wrap;
    e.dataTransfer.setDragImage(wrap, e.clientX - r.left, e.clientY - r.top);
  } catch { /* a missing drag image is not worth breaking the drag over */ }
}

export function clearGhost(store: AppStore) {
  const g = store.ghostRef.current;
  g?.parentNode?.removeChild(g);
  store.ghostRef.current = null;
}

export function dragOverCol(store: AppStore, ci: number, e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const dragId = store.st.dragId;
  if (!dragId) return;

  // Under a sort the rendered order is not the stored one, so a drop index
  // read off the screen would mean nothing. Cards can still change column —
  // they just land at the end and the sort places them.
  if (isSorted(store.st)) {
    if (store.st.board[ci]?.includes(dragId)) return;
    store.moveCard(dragId, ci, null, true);
    return;
  }

  const y = e.clientY;
  const last = store.dragPosRef.current;
  // Ignore jitter; only react to meaningful pointer movement.
  if (last && last.col === ci && Math.abs(last.y - y) < 3) return;

  const host = document.querySelector('[data-col="' + ci + '"]');
  let idx = 0;
  if (host) {
    const cards = Array.from(host.querySelectorAll('[data-cardid]'));
    const dragEl = host.querySelector('[data-cardid="' + dragId + '"]');
    if (dragEl) {
      // Reordering within the column the card already sits in: only swap when
      // the pointer crosses the neighbouring card's threshold, and lock the
      // direction briefly so the card cannot oscillate between two slots.
      const dr = dragEl.getBoundingClientRect();
      const cur = cards.indexOf(dragEl);
      const threshold = Math.min(26, dr.height * 0.34);
      const lock = store.swapLockRef.current;
      const blockDown = lock && lock.col === ci && lock.dir === -1 && y < lock.y + 40;
      const blockUp = lock && lock.col === ci && lock.dir === 1 && y > lock.y - 40;

      if (y > dr.bottom - threshold && !blockDown) {
        idx = Math.min(cards.length, cur + 2);
        store.swapLockRef.current = { col: ci, dir: 1, y };
      } else if (y < dr.top + threshold && !blockUp) {
        idx = Math.max(0, cur - 1);
        store.swapLockRef.current = { col: ci, dir: -1, y };
      } else {
        store.dragPosRef.current = { col: ci, y };
        return;
      }
    } else {
      // Entering a different column: drop above the first card the pointer is
      // in the upper part of, else at the end.
      store.swapLockRef.current = null;
      idx = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (y < r.top + r.height * 0.4) { idx = i; break; }
      }
    }
  }

  store.dragPosRef.current = { col: ci, y };
  store.moveCard(dragId, ci, idx, true);
}

export function endDrag(store: AppStore) {
  clearGhost(store);
  store.dragPosRef.current = null;
  store.swapLockRef.current = null;
  store.set({ dragId: null, overCol: null });
}
