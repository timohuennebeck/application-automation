import { Avatar } from './icons';

export interface StackPerson {
  key?: string;
  initials: string;
  bg: string;
}

/* Up to three faces, overlapped, each ringed in the colour of whatever they
   sit on. Nobody at all is still a face — one muted dash — so the chip keeps
   its height and the row does not jump when the last person is removed.

   The caller maps its own people in, which is where any muting belongs: a
   done round greys its participants, and that is the round's business. */
export function AvatarStack({ people, ring, size }: { people: StackPerson[]; ring: string; size?: number }) {
  const shown: StackPerson[] = people.length
    ? people.slice(0, 3)
    : [{ initials: '–', bg: 'var(--c-b3b0a8)' }];

  return (
    <div style={{ display: 'flex', flexShrink: 0 }}>
      {shown.map((p, i) => (
        <Avatar
          key={p.key ?? i}
          bg={p.bg}
          size={size}
          style={{ boxShadow: '0 0 0 1.5px ' + ring, marginLeft: i ? -6 : 0 }}
        >
          {p.initials}
        </Avatar>
      ))}
    </div>
  );
}

/* How a stack of people names itself: 'Anna Weber', or 'Anna Weber +2'. */
export function stackLabel(names: string[]): string {
  if (!names.length) return 'Kein Kontakt ausgewählt';
  return names.length === 1 ? names[0] : names[0] + ' +' + (names.length - 1);
}
