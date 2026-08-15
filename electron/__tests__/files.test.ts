import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentKind, TemplateKind } from '../../src/shared/enums.ts';
import { toISO } from '../../src/lib/date.ts';
import {
  addProfileDocuments,
  copyCommentAttachment,
  copyDocument,
  addTemplateVersion,
  documentFileName,
  documentPaths,
  isHtml,
  listProfileDocuments,
  listTemplates,
  profileDocumentPath,
  purgeApplicationFiles,
  removeProfileDocument,
  removeStoredFile,
  resolveDocumentPath,
  listTemplateVersions,
  removeTemplateVersion,
  renameTemplateVersion,
  replaceTemplateVersion,
  selectTemplateVersion,
  selectedTemplatePath,
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
    expect(documentFileName(DocumentKind.LEBENSLAUF, 'html')).toBe('Timo_Huennebeck_Lebenslauf.html');
    expect(documentFileName(DocumentKind.COVER_LETTER, 'html')).toBe('Timo_Huennebeck_Anschreiben.html');
    expect(documentFileName(DocumentKind.OTHER, 'html')).toBe('other.html');
  });

  /* Both renditions of a document share the stem, so the PDF is always findable
     from the kind alone. */
  it('gives the two renditions the same stem', () => {
    expect(documentFileName(DocumentKind.LEBENSLAUF, 'pdf')).toBe('Timo_Huennebeck_Lebenslauf.pdf');
    expect(documentFileName(DocumentKind.COVER_LETTER, 'pdf')).toBe('Timo_Huennebeck_Anschreiben.pdf');
  });
});

describe('documentPaths', () => {
  it('puts the PDF beside the HTML it is rendered from', () => {
    const dir = path.join(root, 'documents', 'BEW-33');
    expect(documentPaths(root, 'BEW-33', DocumentKind.LEBENSLAUF)).toEqual({
      htmlAbs: path.join(dir, 'Timo_Huennebeck_Lebenslauf.html'),
      pdfAbs: path.join(dir, 'Timo_Huennebeck_Lebenslauf.pdf'),
      pdfRel: path.join('documents', 'BEW-33', 'Timo_Huennebeck_Lebenslauf.pdf'),
    });
  });

  it('refuses an id that would climb out of the documents folder', () => {
    expect(() => documentPaths(root, '../keep', DocumentKind.LEBENSLAUF)).toThrow(/id/i);
  });
});

describe('copyDocument', () => {
  it('files the copy under the application and returns a relative path', () => {
    const rel = copyDocument(root, 'BEW-33', DocumentKind.LEBENSLAUF, source('Mein CV.html'));

    expect(rel).toBe(path.join('documents', 'BEW-33', 'Timo_Huennebeck_Lebenslauf.html'));
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
    expect(readFileSync(path.join(dir, 'Timo_Huennebeck_Lebenslauf.html'), 'utf8')).toBe('cv');
    expect(readFileSync(path.join(dir, 'Timo_Huennebeck_Anschreiben.html'), 'utf8')).toBe('letter');
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
    expect(resolveDocumentPath(root, rel)).toBe(
      path.join(root, 'documents', 'BEW-33', 'Timo_Huennebeck_Lebenslauf.html'),
    );
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

const CV = 'Timo_Huennebeck_Lebenslauf.html';
const slot = (kind: 'lebenslauf' | 'anschreiben') => path.join(root, 'templates', kind);

describe('template versions', () => {
  it('lists nothing while a slot is empty', () => {
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF)).toEqual([]);
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toBe(null);
    expect(listTemplates(root)).toEqual({ LEBENSLAUF: [], ANSCHREIBEN: [] });
  });

  it('files the first upload as "Standard" and selects it', () => {
    const v = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('Mein Lebenslauf.html', 'cv'));
    expect(v).toEqual({ label: 'Standard', selected: true, name: CV, size: 2, day: toISO(new Date()) });
    expect(readFileSync(path.join(slot('lebenslauf'), 'Standard', CV), 'utf8')).toBe('cv');
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toEqual({
      label: 'Standard',
      path: path.join(slot('lebenslauf'), 'Standard', CV),
    });
  });

  it('auto-names further uploads "Fassung n" and leaves the selection alone', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    const second = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    const third = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('c.html'));
    expect(second.label).toBe('Fassung 2');
    expect(second.selected).toBe(false);
    expect(third.label).toBe('Fassung 3');
    /* Removing the middle one frees its number for the next upload. */
    removeTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2');
    expect(addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('d.html')).label).toBe('Fassung 2');
  });

  it('keeps the picked extension', () => {
    const v = addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.htm', 'cv'));
    expect(v.name).toBe('Timo_Huennebeck_Lebenslauf.htm');
  });

  it('refuses anything but HTML and leaves no slot behind', () => {
    for (const name of ['cv.pdf', 'cv.docx']) {
      expect(() => addTemplateVersion(root, TemplateKind.LEBENSLAUF, source(name)), name).toThrow(/html/i);
    }
    expect(existsSync(path.join(root, 'templates'))).toBe(false);
  });

  it('lists by label with the selected flag', () => {
    addTemplateVersion(root, TemplateKind.ANSCHREIBEN, source('a.html', 'letter'));
    addTemplateVersion(root, TemplateKind.ANSCHREIBEN, source('b.html', 'longer letter'));
    selectTemplateVersion(root, TemplateKind.ANSCHREIBEN, 'Fassung 2');
    expect(listTemplateVersions(root, TemplateKind.ANSCHREIBEN)).toEqual([
      {
        label: 'Fassung 2',
        selected: true,
        name: 'Timo_Huennebeck_Anschreiben.html',
        size: 13,
        day: toISO(new Date()),
      },
      {
        label: 'Standard',
        selected: false,
        name: 'Timo_Huennebeck_Anschreiben.html',
        size: 6,
        day: toISO(new Date()),
      },
    ]);
    expect(selectedTemplatePath(root, TemplateKind.ANSCHREIBEN)!.label).toBe('Fassung 2');
  });

  it('replaces the file of one Fassung without touching the others', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html', 'one'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html', 'two'));
    const v = replaceTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', source('c.htm', 'three'));
    expect(v.label).toBe('Fassung 2');
    expect(v.name).toBe('Timo_Huennebeck_Lebenslauf.htm');
    expect(readdirSync(path.join(slot('lebenslauf'), 'Fassung 2'))).toEqual([
      'Timo_Huennebeck_Lebenslauf.htm',
    ]);
    expect(readFileSync(path.join(slot('lebenslauf'), 'Standard', CV), 'utf8')).toBe('one');
  });

  it('renames a Fassung and carries the selection with it', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    const v = renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Standard', 'Kurz');
    expect(v).toMatchObject({ label: 'Kurz', selected: true });
    expect(existsSync(path.join(slot('lebenslauf'), 'Standard'))).toBe(false);
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)!.label).toBe('Kurz');
  });

  it('refuses unsafe, empty, overlong and duplicate labels', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    for (const bad of ['', '   ', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(41), 'standard', 'STANDARD']) {
      expect(() => renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', bad), bad).toThrow();
    }
    expect(existsSync(path.join(slot('lebenslauf'), 'Fassung 2'))).toBe(true);
    /* Renaming to itself is a no-op, not a duplicate. */
    expect(renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', 'Fassung 2').label).toBe(
      'Fassung 2',
    );
    /* Only whitespace around the label is dropped. */
    expect(renameTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2', '  Kurz ').label).toBe('Kurz');
  });

  it('refuses to remove the selected Fassung', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    expect(() => removeTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Standard')).toThrow(/verwendet/i);
    removeTemplateVersion(root, TemplateKind.LEBENSLAUF, 'Fassung 2');
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF).map((v) => v.label)).toEqual(['Standard']);
  });

  it('heals a missing or stale selection marker to the first label', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('b.html'));
    writeFileSync(path.join(slot('lebenslauf'), '.selected'), 'Weg');
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)!.label).toBe('Fassung 2');
    expect(readFileSync(path.join(slot('lebenslauf'), '.selected'), 'utf8')).toBe('Fassung 2');
    rmSync(path.join(slot('lebenslauf'), '.selected'));
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF).find((v) => v.selected)!.label).toBe(
      'Fassung 2',
    );
  });

  it('skips a Fassung whose file vanished', () => {
    addTemplateVersion(root, TemplateKind.LEBENSLAUF, source('a.html'));
    rmSync(path.join(slot('lebenslauf'), 'Standard', CV));
    expect(listTemplateVersions(root, TemplateKind.LEBENSLAUF)).toEqual([]);
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toBe(null);
  });

  /* Slots used to hold one file directly; that file becomes "Standard". */
  it('moves a single-file slot of an older install into "Standard"', () => {
    mkdirSync(slot('anschreiben'), { recursive: true });
    writeFileSync(path.join(slot('anschreiben'), 'Mein Anschreiben.htm'), 'letter');
    expect(listTemplateVersions(root, TemplateKind.ANSCHREIBEN)).toMatchObject([
      { label: 'Standard', selected: true, name: 'Timo_Huennebeck_Anschreiben.htm' },
    ]);
    expect(
      readFileSync(path.join(slot('anschreiben'), 'Standard', 'Timo_Huennebeck_Anschreiben.htm'), 'utf8'),
    ).toBe('letter');
    expect(existsSync(path.join(slot('anschreiben'), 'Mein Anschreiben.htm'))).toBe(false);
  });

  it('moves the legacy flat file of an even older install into "Standard"', () => {
    mkdirSync(path.join(root, 'templates'), { recursive: true });
    writeFileSync(path.join(root, 'templates', 'lebenslauf.html'), 'old cv');
    expect(selectedTemplatePath(root, TemplateKind.LEBENSLAUF)).toEqual({
      label: 'Standard',
      path: path.join(slot('lebenslauf'), 'Standard', CV),
    });
    expect(existsSync(path.join(root, 'templates', 'lebenslauf.html'))).toBe(false);
  });

  it('refuses a kind that is not one of the two slots', () => {
    expect(() => listTemplateVersions(root, 'OTHER' as TemplateKind)).toThrow(/kind/i);
    expect(() => selectedTemplatePath(root, '../../etc' as TemplateKind)).toThrow(/kind/i);
  });
});

describe('addProfileDocuments', () => {
  it('copies each picked file under its own name and reports what landed', () => {
    const infos = addProfileDocuments(root, [
      source('Immatrikulation.pdf', 'imma bytes'),
      source('Zeugnis.jpg', 'jpg'),
    ]);

    expect(infos).toEqual([
      { name: 'Immatrikulation.pdf', size: 10, day: toISO(new Date()) },
      { name: 'Zeugnis.jpg', size: 3, day: toISO(new Date()) },
    ]);
    expect(readFileSync(path.join(root, 'profile-documents', 'Immatrikulation.pdf'), 'utf8')).toBe(
      'imma bytes',
    );
  });

  /* Two uploads of the same name are both kept — a newer Zeugnis must not
     silently overwrite the older one. */
  it('keeps a second file of the same name beside the first', () => {
    addProfileDocuments(root, [source('a.pdf', 'first')]);
    const [info] = addProfileDocuments(root, [source('a.pdf', 'second')]);

    expect(info.name).toBe('a-2.pdf');
    expect(readFileSync(path.join(root, 'profile-documents', 'a.pdf'), 'utf8')).toBe('first');
    expect(readFileSync(path.join(root, 'profile-documents', 'a-2.pdf'), 'utf8')).toBe('second');
  });

  it('sanitizes a name that would not survive as one path segment', () => {
    const [info] = addProfileDocuments(root, [source('a:b?.pdf', 'x')]);

    expect(info.name).toBe('a-b-.pdf');
    expect(readdirSync(path.join(root, 'profile-documents'))).toEqual(['a-b-.pdf']);
  });
});

describe('listProfileDocuments', () => {
  it('is empty before anything is uploaded', () => {
    expect(listProfileDocuments(root)).toEqual([]);
  });

  it('lists what is on disk, sorted by name', () => {
    addProfileDocuments(root, [source('b.pdf', 'bb'), source('a.pdf', 'a')]);

    expect(listProfileDocuments(root)).toEqual([
      { name: 'a.pdf', size: 1, day: toISO(new Date()) },
      { name: 'b.pdf', size: 2, day: toISO(new Date()) },
    ]);
  });

  /* Finder litters the folder with .DS_Store; that is not a document. */
  it('skips hidden files', () => {
    addProfileDocuments(root, [source('a.pdf', 'a')]);
    writeFileSync(path.join(root, 'profile-documents', '.DS_Store'), '');

    expect(listProfileDocuments(root).map((d) => d.name)).toEqual(['a.pdf']);
  });
});

describe('profileDocumentPath', () => {
  it('resolves a stored name to its absolute path', () => {
    addProfileDocuments(root, [source('a.pdf', 'a')]);

    expect(profileDocumentPath(root, 'a.pdf')).toBe(path.join(root, 'profile-documents', 'a.pdf'));
  });

  /* The name arrives from the renderer; a '..' would hand the OS any file. */
  it('refuses a name that is not one path segment', () => {
    for (const bad of ['../bewerbungen.db', 'x/y.pdf', '/etc/passwd']) {
      expect(() => profileDocumentPath(root, bad), bad).toThrow(/unsafe/);
    }
  });
});

describe('removeProfileDocument', () => {
  it('deletes the one file and leaves the others', () => {
    addProfileDocuments(root, [source('a.pdf', 'a'), source('b.pdf', 'b')]);

    removeProfileDocument(root, 'a.pdf');

    expect(listProfileDocuments(root).map((d) => d.name)).toEqual(['b.pdf']);
  });

  it('tolerates a file that is already gone', () => {
    expect(() => removeProfileDocument(root, 'nope.pdf')).not.toThrow();
  });
});
