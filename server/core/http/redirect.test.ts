import { describe, expect, it } from 'vitest';

import { safeInternalRedirect } from './redirect';

describe('safeInternalRedirect', () => {
  it('keeps ordinary dashboard paths and query strings', () => {
    expect(safeInternalRedirect('/mail?show=received#latest')).toBe(
      '/mail?show=received#latest',
    );
  });

  it.each([
    'https://attacker.example/phish',
    '//attacker.example/phish',
    '/\\attacker.example/phish',
    'javascript:alert(1)',
  ])('refuses the external redirect form %s', (candidate) => {
    expect(safeInternalRedirect(candidate)).toBe('/overview');
  });
});
