import { describe, expect, it } from 'vitest';
import { isHttpUrl } from '../url';

describe('isHttpUrl', () => {
  it('accepts absolute http(s) addresses', () => {
    expect(isHttpUrl('https://firma.de/jobs/123')).toBe(true);
    expect(isHttpUrl('http://localhost:3000')).toBe(true);
    expect(isHttpUrl('  https://firma.de  ')).toBe(true);
  });

  it('rejects everything that is not a web address', () => {
    expect(isHttpUrl('hijk')).toBe(false);
    expect(isHttpUrl('firma.de/karriere')).toBe(false);
    expect(isHttpUrl('www.firma.de')).toBe(false);
    expect(isHttpUrl('https://')).toBe(false);
    expect(isHttpUrl('mailto:jobs@firma.de')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('https://firma de')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
