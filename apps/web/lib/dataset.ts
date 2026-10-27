/** Keep human-readable names first and source links last, independent of JSONB key ordering. */
export function datasetColumns(rows: unknown[]): string[] {
  const columns = [...new Set(rows.flatMap((row) => row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : ['value']))];
  const first = ['title', 'name', 'rank', 'orderId', 'customer', 'price'];
  const last = ['url', 'link', 'sourceUrl', 'imageUrl'];
  const order = (column: string) => first.includes(column) ? first.indexOf(column) : last.includes(column) ? 1000 + last.indexOf(column) : 100;
  return columns.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

/** CSV quoting with spreadsheet formula protection for scraped strings. */
export function datasetCsv(rows: unknown[]): string {
  const columns = datasetColumns(rows);
  const quote = (value: unknown): string => {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value !== 'number' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [columns.map(quote).join(','), ...rows.map((row) => columns.map((column) => quote(row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>)[column] : column === 'value' ? row : undefined)).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function downloadData(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
