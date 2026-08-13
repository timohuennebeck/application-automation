/* Opens a document. A row that points at a real file on disk (one the user
   supplied, or later one the agent generated) is handed to the OS; rows without
   a file still fall back to the placeholder export below, which is what every
   seeded document is until it gets replaced. */
export async function openDocument(
  filePath: string | null,
  name: string,
  card: { id: string; role: string; company: string },
): Promise<string | null> {
  if (!filePath) {
    download(name, card);
    return null;
  }
  const err = await window.desktop?.documents.open(filePath);
  return err ? err : null;
}

/* Placeholder document export. The Agent SDK backend will replace this with the
   real generated .docx once it lands. */
export function download(name: string, card: { id: string; role: string; company: string }) {
  const text = [name, '', card.role, card.company, card.id, '', 'Sarah Thal', ''].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/\s+/g, '-') + '-' + card.id + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
