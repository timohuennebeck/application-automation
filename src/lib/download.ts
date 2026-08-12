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
