// Bon (DESIGN.md 6.17): person A is ink, person B is yellow with a dark outline.
// Taken from the order of household members, not from a stored color.
export type PersonKey = 'a' | 'b' | 'none';

export function personKey(members: { email: string }[], email: string): PersonKey {
  const i = members.findIndex((m) => m.email === email);
  return i === 0 ? 'a' : i === 1 ? 'b' : 'none';
}

/** Class for a small person dot. */
export const personDot = (members: { email: string }[], email: string) =>
  `dot dot-${personKey(members, email)}`;
