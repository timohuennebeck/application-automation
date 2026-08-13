import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentKind } from '../../src/shared/enums.ts';
import {
  copyDocument,
  documentFileName,
  isDocx,
  purgeApplicationFiles,
  resolveDocumentPath,
} from '../files.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bew-files-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/* A source file to be picked, with recognisable contents. */
function source(name: string, body = 'original'): string {
  const p = path.join(root, name);
  writeFileSync(p, body);
  return p;
}

describe('isDocx', () => {
  it('accepts .docx whatever the case', () => {
    expect(isDocx('/a/b/Lebenslauf.docx')).toBe(true);
    expect(isDocx('/a/b/Lebenslauf.DOCX')).toBe(true);
  });

  it('rejects everything else, including the formats that look close', () => {
    for (const name of ['cv.pdf', 'cv.doc', 'cv.pages', 'cv.docx.pdf', 'cv', 'docx']) {
      expect(isDocx('/a/' + name), name).toBe(false);
    }
  });
});

describe('documentFileName', () => {
  it('names the file after its kind, not after what was picked', () => {
    expect(documentFileName(DocumentKind.LEBENSLAUF)).toBe('lebenslauf.docx');
    expect(documentFileName(DocumentKind.COVER_LETTER)).toBe('cover-letter.docx');
    expect(documentFileName(DocumentKind.OTHER)).toBe('other.docx');
  });
});

describe('copyDocument', () => {
  it('files the copy under the application and returns a relative path', () => {
    const rel = copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('Mein CV.docx'));

    expect(rel).toBe(path.join('documents', 'BEW-33', 'lebenslauf.docx'));
    expect(readFileSync(path.join(root, rel), 'utf8')).toBe('original');
  });

  it('overwrites the previous version in place', () => {
    copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.docx', 'first'));
    const rel = copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('b.docx', 'second'));

    expect(readFileSync(path.join(root, rel), 'utf8')).toBe('second');
  });

  it('keeps the two kinds apart', () => {
    copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.docx', 'cv'));
    copyDocument(root, 'BEW-33', DocumentKind.COVER_LETTER, source('b.docx', 'letter'));

    const dir = path.join(root, 'documents', 'BEW-33');
    expect(readFileSync(path.join(dir, 'lebenslauf.docx'), 'utf8')).toBe('cv');
    expect(readFileSync(path.join(dir, 'cover-letter.docx'), 'utf8')).toBe('letter');
  });

  it('refuses anything that is not a .docx, leaving nothing behind', () => {
    expect(() => copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('cv.pdf'))).toThrow(/docx/i);
    expect(existsSync(path.join(root, 'documents', 'BEW-33'))).toBe(false);
  });
});

describe('resolveDocumentPath', () => {
  it('resolves a stored path under the documents folder', () => {
    const rel = copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.docx'));
    expect(resolveDocumentPath(root, rel)).toBe(path.join(root, 'documents', 'BEW-33', 'lebenslauf.docx'));
  });

  it('refuses a path that climbs out of the documents folder', () => {
    for (const bad of ['../bewerbungen.db', 'documents/../../secrets.txt', '../../../etc/passwd']) {
      expect(() => resolveDocumentPath(root, bad), bad).toThrow(/unsafe/i);
    }
  });

  it('refuses an absolute path, which would ignore the base entirely', () => {
    expect(() => resolveDocumentPath(root, '/etc/passwd')).toThrow(/unsafe/i);
  });

  it('refuses a sibling of the documents folder', () => {
    expect(() => resolveDocumentPath(root, 'bewerbungen.db')).toThrow(/unsafe/i);
  });
});

describe('purgeApplicationFiles', () => {
  it('takes the application folder with it', () => {
    copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.docx'));
    copyDocument(root, 'BEW-29', DocumentKind.LEBENSLAUF, source('b.docx'));

    purgeApplicationFiles(root, 'BEW-33');

    expect(existsSync(path.join(root, 'documents', 'BEW-33'))).toBe(false);
    expect(existsSync(path.join(root, 'documents', 'BEW-29'))).toBe(true);
  });

  it('says nothing when there was never a folder', () => {
    expect(() => purgeApplicationFiles(root, 'BEW-01')).not.toThrow();
  });

  it('refuses an id that would climb out of the documents folder', () => {
    mkdirSync(path.join(root, 'keep'), { recursive: true });
    expect(() => purgeApplicationFiles(root, '../keep')).toThrow(/id/i);
    expect(existsSync(path.join(root, 'keep'))).toBe(true);
  });
});
