/** Parse textarea lines into valid iCal feed URLs (http(s) or webcal). */
export function parseIcalImportLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        (l.startsWith('http://') || l.startsWith('https://') || l.startsWith('webcal://')),
    );
}
