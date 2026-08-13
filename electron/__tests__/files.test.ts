import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentKind } from '../../src/shared/enums.ts';
import {
  copyDocument,
  documentFileName,
  documentPaths,
  isHtml,
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

describe('isHtml', () => {
  it('accepts .html and .htm whatever the case', () => {
    for (const name of ['cv.html', 'cv.HTML', 'cv.htm', 'cv.Htm']) {
      expect(isHtml('/a/' + name), name).toBe(true);
    }
  });

  it('rejects everything else, including the formats that look close', () => {
    for (const name of ['cv.pdf', 'cv.docx', 'cv.xhtml', 'cv.html.pdf', 'cv', 'html']) {
      expect(isHtml('/a/' + name), name).toBe(false);
    }
  });
});

describe('documentFileName', () => {
  it('names the file after its kind, not after what was picked', () => {
    expect(documentFileName(DocumentKind.LEBENSLAUF, 'html')).toBe('lebenslauf.html');
    expect(documentFileName(DocumentKind.COVER_LETTER, 'html')).toBe('cover-letter.html');
    expect(documentFileName(DocumentKind.OTHER, 'html')).toBe('other.html');
  });

  /* Both renditions of a document share the stem, so the PDF is always findable
     from the kind alone. */
  it('gives the two renditions the same stem', () => {
    expect(documentFileName(DocumentKind.LEBENSLAUF, 'pdf')).toBe('lebenslauf.pdf');
    expect(documentFileName(DocumentKind.COVER_LETTER, 'pdf')).toBe('cover-letter.pdf');
  });
});

describe('documentPaths', () => {
  it('puts the PDF beside the HTML it is rendered from', () => {
    const dir = path.join(root, 'documents', 'BEW-33');
    expect(documentPaths(root, 'BEW-33', DocumentKind.LEBENSLAUF)).toEqual({
      htmlAbs: path.join(dir, 'lebenslauf.html'),
      pdfAbs: path.join(dir, 'lebenslauf.pdf'),
      pdfRel: path.join('documents', 'BEW-33', 'lebenslauf.pdf'),
    });
  });

  it('refuses an id that would climb out of the documents folder', () => {
    expect(() => documentPaths(root, '../keep', DocumentKind.LEBENSLAUF)).toThrow(/id/i);
  });
});

describe('copyDocument', () => {
  it('files the copy under the application and returns a relative path', () => {
    const rel = copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('Mein CV.html'));

    expect(rel).toBe(path.join('documents', 'BEW-33', 'lebenslauf.html'));
    expect(readFileSync(path.join(root, rel), 'utf8')).toBe('original');
  });

  it('overwrites the previous version in place', () => {
    copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.html', 'first'));
    const rel = copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('b.html', 'second'));

    expect(readFileSync(path.join(root, rel), 'utf8')).toBe('second');
  });

  it('keeps the two kinds apart', () => {
    copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.html', 'cv'));
    copyDocument(root, 'BEW-33', DocumentKind.COVER_LETTER, source('b.html', 'letter'));

    const dir = path.join(root, 'documents', 'BEW-33');
    expect(readFileSync(path.join(dir, 'lebenslauf.html'), 'utf8')).toBe('cv');
    expect(readFileSync(path.join(dir, 'cover-letter.html'), 'utf8')).toBe('letter');
  });

  it('refuses anything that is not HTML, leaving nothing behind', () => {
    for (const name of ['cv.pdf', 'cv.docx']) {
      expect(() => copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source(name)), name).toThrow(
        /html/i,
      );
    }
    expect(existsSync(path.join(root, 'documents', 'BEW-33'))).toBe(false);
  });
});

describe('resolveDocumentPath', () => {
  it('resolves a stored path under the documents folder', () => {
    const rel = copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.html'));
    expect(resolveDocumentPath(root, rel)).toBe(path.join(root, 'documents', 'BEW-33', 'lebenslauf.html'));
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
    copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('a.html'));
    copyDocument(root, 'BEW-29', DocumentKind.LEBENSLAUF, source('b.html'));

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
