// RFC-4180-style CSV ingestion for the official NPA export.
// Handles UTF-8 BOM, CRLF, quoted commas, escaped quotes, embedded newlines.
// No third-party parser required.
export function parseCsvRecords(input) {
  if (typeof input !== 'string') throw new TypeError('CSV input must be a string');
  const value = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;

  const pushField = () => {
    row.push(field);
    field = '';
    afterQuote = false;
  };
  const pushRow = () => {
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inQuotes) {
      if (ch === '"') {
        if (value[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; afterQuote = true; }
      } else {
        field += ch;
      }
      continue;
    }
    if (afterQuote) {
      if (ch === ' ' || ch === '\t') continue;
      if (ch === ',') { pushField(); continue; }
      if (ch === '\r' || ch === '\n') {
        pushField(); pushRow();
        if (ch === '\r' && value[i + 1] === '\n') i++;
        continue;
      }
      throw new Error('Unexpected text after closing CSV quote');
    }
    if (ch === '"') {
      if (field !== '') throw new Error('Unexpected CSV quote');
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r' || ch === '\n') {
      pushField(); pushRow();
      if (ch === '\r' && value[i + 1] === '\n') i++;
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('Unclosed quoted CSV field');
  if (field !== '' || row.length || afterQuote) {
    pushField(); pushRow();
  }
  return rows;
}

export function parseCsvObjects(input) {
  const rows = parseCsvRecords(input);
  if (!rows.length) return [];
  const [header, ...body] = rows;
  const names = header.map((name) => name.trim());
  if (!names.every(Boolean) || new Set(names).size !== names.length) {
    throw new Error('CSV header has empty or duplicate column names');
  }
  return body.map((row, i) => {
    if (row.length !== names.length) {
      throw new Error('CSV row ' + (i + 2) + ' has ' + row.length + ' fields; expected ' + names.length);
    }
    return Object.fromEntries(names.map((name, index) => [name, row[index]]));
  });
}
