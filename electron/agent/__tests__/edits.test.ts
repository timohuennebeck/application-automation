import { describe, expect, it } from 'vitest';
import { applyEdits, reverseEdits } from '../edits.ts';
import { validateAsk } from '../schemas.ts';
import type { DocumentEdit } from '../../../src/shared/db-types.ts';
import { DocumentKind, EditKind } from '../../../src/shared/enums.ts';

const LETTER =
  '<!doctype html><html><body>' +
  '<p class="recipient">Engineering Hiring Team</p>' +
  '<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>' +
  '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>' +
  '</body></html>';

const edit = (over: Partial<DocumentEdit>): DocumentEdit => ({
  document: DocumentKind.COVER_LETTER,
  kind: EditKind.REPLACE,
  find: '',
  replace: '',
  after: null,
  ...over,
});

describe('applyEdits', () => {
  it('replaces a passage that occurs exactly once', () => {
    const res = applyEdits(LETTER, [
      edit({ find: 'Engineering Hiring Team</p>', replace: 'Frau Maria Haushofer</p>' }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).toContain('<p class="recipient">Frau Maria Haushofer</p>');
  });

  it('refuses a passage that occurs twice, and changes nothing', () => {
    /* "Engineering Hiring Team" appears in the recipient AND the salutation.
       Rewriting the first one silently is the failure this rule exists for. */
    const res = applyEdits(LETTER, [edit({ find: 'Engineering Hiring Team', replace: 'X' })]);

    expect(res.failed).not.toBeNull();
    expect(res.reason).toContain('mehrfach');
    expect(res.html).toBe(LETTER);
  });

  it('refuses a passage that does not occur at all', () => {
    const res = applyEdits(LETTER, [edit({ find: 'Sehr geehrte Frau Weber', replace: 'X' })]);

    expect(res.failed).not.toBeNull();
    expect(res.reason).toContain('nicht');
    expect(res.html).toBe(LETTER);
  });

  it('applies nothing when one edit of several misses', () => {
    /* All or nothing: a letter whose recipient changed but whose salutation
       did not is worse than one left alone. */
    const res = applyEdits(LETTER, [
      edit({ find: 'Engineering Hiring Team</p>', replace: 'Frau Maria Haushofer</p>' }),
      edit({ find: 'gibt es nicht', replace: 'X' }),
    ]);

    expect(res.failed?.find).toBe('gibt es nicht');
    expect(res.html).toBe(LETTER);
  });

  it('deletes a passage', () => {
    const res = applyEdits(LETTER, [
      edit({
        kind: EditKind.DELETE,
        find: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
      }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).not.toContain('Gehaltserwartung');
  });

  it('inserts after an anchor', () => {
    const res = applyEdits(LETTER, [
      edit({
        kind: EditKind.INSERT,
        after: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
        replace: '<p>Über Ihre Rückmeldung freue ich mich sehr.</p>',
      }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).toContain('brutto p.a.</p><p>Über Ihre Rückmeldung freue ich mich sehr.</p>');
  });

  it('refuses an insert whose anchor is not unique', () => {
    const res = applyEdits(LETTER, [
      edit({ kind: EditKind.INSERT, after: 'Engineering Hiring Team', replace: '<p>X</p>' }),
    ]);

    expect(res.failed).not.toBeNull();
    expect(res.html).toBe(LETTER);
  });

  it('applies each edit against the document the previous one left', () => {
    /* Two edits where the second's passage only exists after the first ran
       would be a trap; both are measured against the running document, so the
       order the model returned them in is the order they take effect. */
    const res = applyEdits('<p>eins</p><p>zwei</p>', [
      edit({ find: '<p>eins</p>', replace: '<p>drei</p>' }),
      edit({ find: '<p>drei</p>', replace: '<p>vier</p>' }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).toBe('<p>vier</p><p>zwei</p>');
  });

  it('leaves the document byte-identical when handed no edits', () => {
    expect(applyEdits(LETTER, []).html).toBe(LETTER);
  });

  it('refuses a deletion whose anchor is not the bytes right before it', () => {
    /* The anchor is only ever read by reverseEdits, months later. One that
       resolves but is not adjacent puts the passage back somewhere it never
       stood — inside the salutation paragraph here, nesting a <p> in a <p>.
       Caught while the document still says what the edit was written
       against, rather than silently on the way back. */
    const res = applyEdits(LETTER, [
      edit({
        kind: EditKind.DELETE,
        find: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
        after: 'Sehr geehrtes Engineering Hiring Team,',
      }),
    ]);

    expect(res.html).toBe(LETTER);
    expect(res.failed).not.toBeNull();
    expect(res.reason).toContain('steht nicht direkt hinter');
  });

  it('refuses a deletion whose anchor occurs more than once', () => {
    const res = applyEdits(LETTER, [
      edit({
        kind: EditKind.DELETE,
        find: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
        after: 'Engineering Hiring Team',
      }),
    ]);

    expect(res.html).toBe(LETTER);
    expect(res.failed).not.toBeNull();
  });
});

describe('reverseEdits', () => {
  it('turns a replacement around', () => {
    const [back] = reverseEdits([edit({ find: 'alt', replace: 'neu' })]);

    expect(back.find).toBe('neu');
    expect(back.replace).toBe('alt');
    expect(back.kind).toBe(EditKind.REPLACE);
  });

  it('turns a deletion into an insertion and back', () => {
    const [back] = reverseEdits([edit({ kind: EditKind.DELETE, find: '<p>weg</p>', after: '<p>davor</p>' })]);

    expect(back.kind).toBe(EditKind.INSERT);
    expect(back.replace).toBe('<p>weg</p>');
    expect(back.after).toBe('<p>davor</p>');
  });

  it('turns an insertion into a deletion', () => {
    const [back] = reverseEdits([
      edit({ kind: EditKind.INSERT, replace: '<p>neu</p>', after: '<p>davor</p>' }),
    ]);

    expect(back.kind).toBe(EditKind.DELETE);
    expect(back.find).toBe('<p>neu</p>');
  });

  it('reverses in the opposite order, so a chain undoes cleanly', () => {
    const back = reverseEdits([edit({ find: 'a', replace: 'b' }), edit({ find: 'b', replace: 'c' })]);

    expect(back.map((e) => e.find)).toEqual(['c', 'b']);
  });

  /* Every other test here hand-fills `after` on a deletion, which is exactly
     how the missing anchor stayed invisible: nothing on the production path
     used to require one. This one takes the set the way ask() gets it — out of
     the validator, from a payload shaped like the model's answer — so a
     deletion that reaches applyEdits can always be taken back out again. */
  it('round-trips a deletion whose anchor came through the validator', () => {
    const { edits } = validateAsk({
      antwort: 'Die Gehaltserwartung ist raus.',
      edits: [
        {
          document: 'COVER_LETTER',
          kind: 'delete',
          find: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
          replace: '',
          after: '<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>',
        },
      ],
    });
    expect(edits).toHaveLength(1);

    const forward = applyEdits(LETTER, edits);
    expect(forward.failed).toBeNull();
    expect(forward.html).not.toContain('Gehaltserwartung');

    const backward = applyEdits(forward.html, reverseEdits(edits));

    expect(backward.failed).toBeNull();
    expect(backward.html).toBe(LETTER);
  });

  it('round-trips a document to its original bytes', () => {
    const edits = [
      edit({ find: 'Engineering Hiring Team</p>', replace: 'Frau Maria Haushofer</p>' }),
      edit({
        kind: EditKind.DELETE,
        find: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
        after: '<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>',
      }),
    ];
    const forward = applyEdits(LETTER, edits);
    expect(forward.failed).toBeNull();

    const backward = applyEdits(forward.html, reverseEdits(edits));

    expect(backward.failed).toBeNull();
    expect(backward.html).toBe(LETTER);
  });
});
