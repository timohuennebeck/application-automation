import type { CSSProperties } from 'react';
import { roundColumn } from '../../data/config';
import { StatusDot } from '../../ui/icons';

/* Interview state ring. It takes accent and fill from the pipeline stage the
   round maps onto, so the round list reads like the status list. Done rounds
   are muted by their row's opacity, not by a different colour.

   Pass the round's own `stage`; index and total are the fallback for rounds
   saved before rounds carried one. */
export function RoundDot({
  index,
  total,
  stage = '',
  size = 13,
  style,
}: {
  index: number;
  total: number;
  stage?: string;
  size?: number;
  style?: CSSProperties;
}) {
  const col = roundColumn(stage, index, total);
  return <StatusDot kind={col.kind} accent={col.accent} frac={col.frac} size={size} style={style} />;
}
