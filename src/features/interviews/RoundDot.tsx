import { roundStage } from '../../data/config';
import { StatusDot } from '../../ui/icons';

/* Interview state ring. It takes accent and fill from the pipeline stage the
   round maps onto, so the round list reads like the status list. Done rounds
   are muted by their row's opacity, not by a different colour. */
export function RoundDot({ index, total, size = 13 }: { index: number; total: number; size?: number }) {
  const col = roundStage(index, total);
  return <StatusDot kind={col.kind} accent={col.accent} frac={col.frac} size={size} />;
}
