import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentKind, TemplateKind } from '../../src/shared/enums.ts';
import { toISO } from '../../src/lib/date.ts';
import {
  copyCommentAttachment,
  copyDocument,
  copyTemplate,
  documentFileName,
  documentPaths,
  isHtml,
  listTemplates,
  purgeApplicationFiles,
  removeStoredFile,
  resolveDocumentPath,
  templatePath,
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

describe('copyCommentAttachment', () => {
  it('files the copy under attachments/ and reports path, name and size', () => {
    const copy = copyCommentAttachment(root, 'BEW-33', source('Zeugnis 2024.pdf', 'pdf bytes'));

    expect(copy).toEqual({
      filePath: path.join('documents', 'BEW-33', 'attachments', 'Zeugnis 2024.pdf'),
      name: 'Zeugnis 2024.pdf',
      size: 9,
    });
    expect(readFileSync(path.join(root, copy.filePath), 'utf8')).toBe('pdf bytes');
  });

  it('keeps two picks of the same name apart instead of overwriting', () => {
    mkdirSync(path.join(root, 'elsewhere'));
    const a = copyCommentAttachment(root, 'BEW-33', source('x.pdf', 'first'));
    const b = copyCommentAttachment(root, 'BEW-33', source(path.join('elsewhere', 'x.pdf'), 'second'));

    expect(path.basename(a.filePath)).toBe('x.pdf');
    expect(path.basename(b.filePath)).toBe('x-2.pdf');
    expect(readFileSync(path.join(root, a.filePath), 'utf8')).toBe('first');
    expect(readFileSync(path.join(root, b.filePath), 'utf8')).toBe('second');
    /* The display name is the picked one either way. */
    expect(b.name).toBe('x.pdf');
  });

  it('stores a hostile name flattened, never escaping the folder', () => {
    mkdirSync(path.join(root, 'evil'));
    const copy = copyCommentAttachment(root, 'BEW-33', source(path.join('evil', '..pass..wd')));

    expect(path.dirname(copy.filePath)).toBe(path.join('documents', 'BEW-33', 'attachments'));
    expect(path.basename(copy.filePath)).toBe('pass..wd');
  });

  it('refuses an id that would climb out of the documents folder', () => {
    expect(() => copyCommentAttachment(root, '../keep', source('a.pdf'))).toThrow(/id/i);
  });
});

describe('removeStoredFile', () => {
  it('removes the file it is pointed at', () => {
    const copy = copyCommentAttachment(root, 'BEW-33', source('a.pdf'));

    removeStoredFile(root, copy.filePath);

    expect(existsSync(path.join(root, copy.filePath))).toBe(false);
  });

  it('says nothing when the file is already gone', () => {
    expect(() =>
      removeStoredFile(root, path.join('documents', 'BEW-33', 'attachments', 'a.pdf')),
    ).not.toThrow();
  });

  it('refuses a path outside the documents folder', () => {
    expect(() => removeStoredFile(root, '../bewerbungen.db')).toThrow(/unsafe/i);
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

  it('takes comment attachments with it', () => {
    const copy = copyCommentAttachment(root, 'BEW-33', source('a.pdf'));

    purgeApplicationFiles(root, 'BEW-33');

    expect(existsSync(path.join(root, copy.filePath))).toBe(false);
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

describe('templatePath', () => {
  it('is null while nothing has been uploaded', () => {
    expect(templatePath(root, TemplateKind.LEBENSLAUF)).toBe(null);
  });

  it('points at the uploaded file under its own name', () => {
    copyTemplate(root, TemplateKind.LEBENSLAUF, source('Mein Lebenslauf.html', 'cv'));

    expect(templatePath(root, TemplateKind.LEBENSLAUF)).toBe(
      path.join(root, 'templates', 'lebenslauf', 'Mein Lebenslauf.html'),
    );
  });

  /* Uploads from before original names were kept sit flat in templates/ under
     a fixed name; an existing install must keep its documents. */
  it('falls back to the legacy flat file of an older install', () => {
    mkdirSync(path.join(root, 'templates'), { recursive: true });
    writeFileSync(path.join(root, 'templates', 'lebenslauf.html'), 'old cv');

    expect(templatePath(root, TemplateKind.LEBENSLAUF)).toBe(
      path.join(root, 'templates', 'lebenslauf.html'),
    );
  });

  /* The kind arrives from the renderer, so an unknown one must not fall through
     to path.join(dir, undefined) and fail somewhere less obvious. */
  it('refuses a kind that is not one of the two slots', () => {
    expect(() => templatePath(root, 'OTHER' as TemplateKind)).toThrow(/kind/i);
    expect(() => templatePath(root, '../../etc/passwd' as TemplateKind)).toThrow(/kind/i);
  });
});

describe('copyTemplate', () => {
  it('stores the file under its slot and reports what landed there', () => {
    const info = copyTemplate(root, TemplateKind.LEBENSLAUF, source('Mein Lebenslauf.html', 'cv bytes'));

    expect(readFileSync(templatePath(root, TemplateKind.LEBENSLAUF)!, 'utf8')).toBe('cv bytes');
    expect(info).toEqual({ name: 'Mein Lebenslauf.html', size: 8, day: toISO(new Date()) });
  });

  it('overwrites the slot rather than piling up versions', () => {
    copyTemplate(root, TemplateKind.LEBENSLAUF, source('a.html', 'first'));
    const info = copyTemplate(root, TemplateKind.LEBENSLAUF, source('b.html', 'second'));

    expect(info.name).toBe('b.html');
    expect(readdirSync(path.join(root, 'templates', 'lebenslauf'))).toEqual(['b.html']);
  });

  it('replaces the legacy flat file of an older install', () => {
    mkdirSync(path.join(root, 'templates'), { recursive: true });
    writeFileSync(path.join(root, 'templates', 'lebenslauf.html'), 'old cv');

    copyTemplate(root, TemplateKind.LEBENSLAUF, source('Neu.html', 'new cv'));

    expect(existsSync(path.join(root, 'templates', 'lebenslauf.html'))).toBe(false);
    expect(templatePath(root, TemplateKind.LEBENSLAUF)).toBe(
      path.join(root, 'templates', 'lebenslauf', 'Neu.html'),
    );
  });

  /* The name the user picked is the point — a .htm stays a .htm. */
  it('keeps the picked name, extension included', () => {
    const info = copyTemplate(root, TemplateKind.LEBENSLAUF, source('a.htm', 'cv'));

    expect(info.name).toBe('a.htm');
    expect(readFileSync(templatePath(root, TemplateKind.LEBENSLAUF)!, 'utf8')).toBe('cv');
  });

  it('keeps the two slots apart', () => {
    copyTemplate(root, TemplateKind.LEBENSLAUF, source('a.html', 'cv'));
    copyTemplate(root, TemplateKind.ANSCHREIBEN, source('b.html', 'letter'));

    expect(readFileSync(templatePath(root, TemplateKind.LEBENSLAUF)!, 'utf8')).toBe('cv');
    expect(readFileSync(templatePath(root, TemplateKind.ANSCHREIBEN)!, 'utf8')).toBe('letter');
  });

  /* The agent edits the markup and exports the PDF from it, so a finished PDF
     or a Word file is the wrong end of the pipeline. */
  it('refuses anything that is not HTML, leaving the slot empty', () => {
    for (const name of ['cv.pdf', 'cv.docx']) {
      expect(() => copyTemplate(root, TemplateKind.LEBENSLAUF, source(name)), name).toThrow(/html/i);
    }
    expect(existsSync(path.join(root, 'templates'))).toBe(false);
  });
});

describe('listTemplates', () => {
  it('reports both slots as empty before anything is uploaded', () => {
    expect(listTemplates(root)).toEqual({ LEBENSLAUF: null, ANSCHREIBEN: null });
  });

  it('reports name, size and day for the slot that is filled', () => {
    copyTemplate(root, TemplateKind.ANSCHREIBEN, source('a.html', 'letter'));

    expect(listTemplates(root)).toEqual({
      LEBENSLAUF: null,
      ANSCHREIBEN: { name: 'a.html', size: 6, day: toISO(new Date()) },
    });
  });

  /* Deleted from Finder, or never synced down: the slot reads as empty again
     rather than offering a file that cannot be opened. */
  it('treats a file that vanished as an empty slot', () => {
    copyTemplate(root, TemplateKind.LEBENSLAUF, source('a.html'));
    rmSync(templatePath(root, TemplateKind.LEBENSLAUF)!);

    expect(listTemplates(root).LEBENSLAUF).toBe(null);
  });
});
