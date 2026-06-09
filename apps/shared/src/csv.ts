/**
 * Escape a CSV cell: neutralize formula triggers, then RFC 4180 quote.
 */
export const escapeCsvCell = (value: string): string => {
    let cell = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    if (/[",\n\r]/.test(cell)) {
        cell = `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
};

/**
 * Render rows to a CSV document with a header line, escaping every cell.
 */
export const toCsv = (header: readonly string[], rows: ReadonlyArray<readonly string[]>): string =>
    [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
