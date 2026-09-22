import { describe, expect, it } from 'vitest';

import { keepWithin } from './select-value';

/**
 * The rule this encodes: a select's value must always be a member of its own
 * options. Base UI prints the raw value when it cannot find it, which is how
 * `dom_x7fK…` reaches the screen instead of a domain name.
 */
describe('keepWithin', () => {
  const options = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('keeps a value that is on offer', () => {
    expect(keepWithin('b', options)).toBe('b');
  });

  it('falls back when the value was never on offer', () => {
    // The initial value taken from a wider list than the options — an address
    // picked from every address, offered from only the unbound ones.
    expect(keepWithin('z', options)).toBe('a');
  });

  it('falls back when the options shrink underneath it', () => {
    // Binding an address removes it from the list of addresses still available
    // to bind; the value must not be left pointing at it.
    const remaining = options.filter((option) => option.id !== 'b');
    expect(keepWithin('b', remaining)).toBe('a');
  });

  it('is empty when nothing is on offer', () => {
    expect(keepWithin('a', [])).toBe('');
  });

  it('does not treat an empty value as a member', () => {
    expect(keepWithin('', options)).toBe('a');
  });
});
