import { describe, expect, it } from 'vitest';
import { unsafePermissions, type Permission } from './drive';

describe('folder sharing check', () => {
  const members = ['ana@example.com', 'Mihai@example.com'];
  it('allows only the two members', () => {
    const perms: Permission[] = [
      { id: '1', type: 'user', role: 'owner', emailAddress: 'ana@example.com' },
      { id: '2', type: 'user', role: 'writer', emailAddress: 'mihai@example.com' },
    ];
    expect(unsafePermissions(perms, members)).toEqual([]);
  });
  it('flags anyone-with-the-link, domains, groups and other people', () => {
    const perms: Permission[] = [
      { id: '1', type: 'user', role: 'owner', emailAddress: 'ana@example.com' },
      { id: '3', type: 'anyone', role: 'reader' },
      { id: '4', type: 'domain', role: 'reader', domain: 'example.com' },
      { id: '5', type: 'user', role: 'reader', emailAddress: 'someone@example.com' },
      { id: '6', type: 'group', role: 'reader', emailAddress: 'family@example.com' },
    ];
    expect(unsafePermissions(perms, members).map((p) => p.id)).toEqual(['3', '4', '5', '6']);
  });
});
