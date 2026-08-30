import { describe, expect, it } from 'vitest';
import { normalizeRole } from '../text';

describe('normalizeRole', () => {
  it.each([
    ['Frontend Engineer (all genders)', 'Frontend Engineer'],
    ['Frontend Engineer (m/w/d)', 'Frontend Engineer'],
    ['Frontend Engineer (w/m/d)', 'Frontend Engineer'],
    ['Frontend Engineer (f/m/x)', 'Frontend Engineer'],
    ['Frontend Engineer (m/w/div)', 'Frontend Engineer'],
    ['Frontend Engineer (gn)', 'Frontend Engineer'],
    ['Frontend Engineer [m/w/d]', 'Frontend Engineer'],
    ['Frontend Engineer m/w/d', 'Frontend Engineer'],
    ['Frontend Engineer - all genders', 'Frontend Engineer'],
    ['Frontend Engineer – (m/w/d) –', 'Frontend Engineer'],
    ['Senior (m/w/d) Frontend Engineer', 'Senior Frontend Engineer'],
    ['Softwareentwickler*in Frontend', 'Softwareentwickler Frontend'],
    ['Softwareentwickler:in', 'Softwareentwickler'],
    ['Softwareentwickler/in (m/w/d)', 'Softwareentwickler'],
    ['Entwickler(in)', 'Entwickler'],
    ['Entwickler*innen', 'Entwickler'],
    ['  Frontend   Engineer  ', 'Frontend Engineer'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });

  it('leaves titles without a marker alone', () => {
    expect(normalizeRole('Frontend / UX Engineer')).toBe('Frontend / UX Engineer');
    expect(normalizeRole('Co-Founder & CEO, Atira (unbestätigt)')).toBe(
      'Co-Founder & CEO, Atira (unbestätigt)',
    );
    expect(normalizeRole('Fullstack Software Engineer, Perception Experience')).toBe(
      'Fullstack Software Engineer, Perception Experience',
    );
    expect(normalizeRole('Head of Design')).toBe('Head of Design');
    expect(normalizeRole('Engineer in Residence')).toBe('Engineer in Residence');
  });
});
