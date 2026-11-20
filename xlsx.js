/* Générateur .xlsx minimal, sans dépendance (zip "stored" + XML). */
(function (g) {
  const enc = new TextEncoder();
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const col = i => { let s = '', n = i + 1; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };
  let T;
  function crc32(b) {
    if (!T) { T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } }
    let r = -1; for (let i = 0; i < b.length; i++) r = T[(r ^ b[i]) & 255] ^ (r >>> 8);
    return (r ^ -1) >>> 0;
  }
  function zip(files) {
    const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const parts = [], cen = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), d = f.data, c = crc32(d);
      const lh = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(nm.length), ...u16(0)];
      parts.push(new Uint8Array(lh), nm, d);
      cen.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
      off += lh.length + nm.length + d.length;
    }
    const cs = cen.reduce((a, b) => a + b.length, 0), n = files.length;
    parts.push(...cen, new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(cs), ...u32(off), ...u16(0)]));
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let p = 0;
    for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  }
  // sheets : [{ name, rows }] ; 1re ligne en gras ; cellule = valeur ou { v, b:true }
  function makeXlsx(sheets) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const files = [
      ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
      ['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', X + `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', X + `<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ];
    sheets.forEach((s, si) => {
      const w = [];
      const rows = s.rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((c, ci) => {
        const o = c !== null && typeof c === 'object' ? c : { v: c };
        const b = o.b || ri === 0, v = o.v, ref = col(ci) + (ri + 1);
        w[ci] = Math.max(w[ci] || 8, String(v ?? '').length + 2);
        if (v === '' || v === null || v === undefined) return '';
        if (typeof v === 'number') return `<c r="${ref}" s="${b ? 3 : 2}"><v>${v}</v></c>`;
        return `<c r="${ref}" s="${b ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('') + '</row>').join('');
      files.push([`xl/worksheets/sheet${si + 1}.xml`, X + `<worksheet ${NS}><cols>` + w.map((n, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(n, 60)}" customWidth="1"/>`).join('') + `</cols><sheetData>${rows}</sheetData></worksheet>`]);
    });
    return zip(files.map(([name, t]) => ({ name, data: enc.encode(t) })));
  }
  if (typeof module !== 'undefined') module.exports = makeXlsx; else g.makeXlsx = makeXlsx;
})(this);
