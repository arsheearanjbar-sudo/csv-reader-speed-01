// Fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
// Same answers as csv-reader's readCsv for every input, but faster:
// fields are sliced once from the input instead of built character by
// character, quoted fields are skipped with indexOf, and the hot loop
// keeps its state in locals. Pure: no clock, no randomness, no locale,
// nothing kept from one call to the next.

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  const COMMA = 0;
  const LB = 1;
  const END = 2;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break.
  // A CR not followed by LF is dropped (stray_cr). Returns the field, how it
  // ended, and how many characters were kept (`added`).
  function readUnquoted(value) {
    let added = 0;
    let seg = pos;
    for (;;) {
      while (pos < n) {
        const c = text.charCodeAt(pos);
        if (c === 44 || c === 10 || c === 13) break;
        pos++;
      }
      if (pos >= n) {
        const tail = text.slice(seg, pos);
        added += tail.length;
        if (value === '') value = tail;
        else if (tail !== '') value += tail;
        return { value, ended: END, added };
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        const tail = text.slice(seg, pos);
        added += tail.length;
        if (value === '') value = tail;
        else if (tail !== '') value += tail;
        pos++;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        const tail = text.slice(seg, pos);
        added += tail.length;
        if (value === '') value = tail;
        else if (tail !== '') value += tail;
        pos++;
        line++;
        return { value, ended: LB, added };
      }
      // CR
      if (text.charCodeAt(pos + 1) === 10) {
        const tail = text.slice(seg, pos);
        added += tail.length;
        if (value === '') value = tail;
        else if (tail !== '') value += tail;
        pos += 2;
        line++;
        return { value, ended: LB, added };
      }
      // Lone CR: stray_cr, drop it, keep reading the field.
      error('stray_cr');
      const tail = text.slice(seg, pos);
      added += tail.length;
      if (value === '') value = tail;
      else if (tail !== '') value += tail;
      pos++;
      seg = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos++;
    // Fast path: the closing quote is the next quote, it is not doubled,
    // and the content holds no CR or LF, so the field is one slice.
    const close = text.indexOf('"', pos);
    if (close !== -1 && text.charCodeAt(close + 1) !== 34) {
      const cr = text.indexOf('\r', pos);
      const lf = text.indexOf('\n', pos);
      if ((cr === -1 || cr >= close) && (lf === -1 || lf >= close)) {
        const value = text.slice(pos, close);
        pos = close + 1;
        if (pos >= n) return { value, ended: END };
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos++;
          return { value, ended: COMMA };
        }
        if (c === 10) {
          pos++;
          line++;
          return { value, ended: LB };
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line++;
          return { value, ended: LB };
        }
        const junk = readUnquoted(value);
        if (junk.added > 0) error('quote_junk');
        return junk;
      }
    }
    // Slow path: doubled quotes, a CR or LF inside, or no closing quote.
    // Scan as the reference does, but in segments instead of one
    // character at a time.
    let value = '';
    let seg = pos;
    let closed = false;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          value += text.slice(seg, pos);
          value += '"';
          pos += 2;
          seg = pos;
          continue;
        }
        value += text.slice(seg, pos);
        pos++;
        closed = true;
        break;
      }
      if (c === 13) {
        value += text.slice(seg, pos);
        value += '\n';
        line++;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        seg = pos;
        continue;
      }
      if (c === 10) {
        value += text.slice(seg, pos);
        value += '\n';
        line++;
        pos++;
        seg = pos;
        continue;
      }
      pos++;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos++;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos++;
      line++;
      return { value, ended: LB };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line++;
      return { value, ended: LB };
    }
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
