// Minimal, dependency-free .xlsx writer for the browser.
//
// Callers build a `matrix` (array of rows; each row an array of { v, s } cells
// where `s` indexes XLSX_STYLE) plus optional A1-style `mergeRefs`, then call
// downloadXlsx(). A real Office Open XML package is assembled and zipped here
// (stored/no-compression + CRC32) so no third-party library is needed.

// Style indices into styles.xml's <cellXfs> (see _xlsxStylesXml).
//   RED / AMBER          → coloured text + matching fill (Connection, ACK No / Yes via GREEN)
//   GREEN                → green text + green fill (ACK Yes)
//   *_TEXT / *_TEXT_STRIPE → coloured text that keeps the row's background (default
//                            white vs. zebra stripe). Used for nozzle status.
const XLSX_STYLE = {
    DEFAULT: 0, HEADER: 1, RED: 2, AMBER: 3, STRIPE: 4, GREEN: 5,
    RED_TEXT: 6, AMBER_TEXT: 7, RED_TEXT_STRIPE: 8, AMBER_TEXT_STRIPE: 9
};

const _xmlEsc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 0-based column index -> spreadsheet column letters (0->A, 25->Z, 26->AA).
function _xlsxColRef(n) {
    let s = '';
    n += 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

// styles.xml: fonts/fills/borders + cell formats matching XLSX_STYLE —
// default, header (teal bg / white bold), red & amber (coloured bold text + matching
// fill), stripe (light-blue bg) for zebra rows, green (green bold text + green fill),
// and red-text / amber-text (coloured bold text, no fill).
function _xlsxStylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="5">'
        + '<font><sz val="11"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FF842029"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FF664D03"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FF1E7B34"/><name val="Calibri"/></font>'
        + '</fonts>'
        + '<fills count="7">'
        + '<fill><patternFill patternType="none"/></fill>'
        + '<fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FF004D64"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFF8D7DA"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CD"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EA"/></patternFill></fill>'
        + '</fills>'
        + '<borders count="2">'
        + '<border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>'
        + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="10">'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>';
}

// worksheet XML from a matrix of { v, s } cells. Values written as inline
// strings. `mergeRefs` is an array of A1-style ranges to merge.
function _xlsxSheetXml(matrix, mergeRefs) {
    let rows = '';
    for (let r = 0; r < matrix.length; r++) {
        const rowNum = r + 1;
        let cells = '';
        const cols = matrix[r];
        for (let c = 0; c < cols.length; c++) {
            const ref = _xlsxColRef(c) + rowNum;
            const { v, s } = cols[c];
            cells += `<c r="${ref}" s="${s || 0}" t="inlineStr"><is><t xml:space="preserve">${_xmlEsc(v)}</t></is></c>`;
        }
        rows += `<row r="${rowNum}">${cells}</row>`;
    }
    const mc = (mergeRefs && mergeRefs.length)
        ? `<mergeCells count="${mergeRefs.length}">`
            + mergeRefs.map(ref => `<mergeCell ref="${ref}"/>`).join('')
            + '</mergeCells>'
        : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<sheetData>${rows}</sheetData>${mc}</worksheet>`;
}

function _buildXlsxBlob(sheetName, matrix, mergeRefs) {
    const files = [
        { name: '[Content_Types].xml', data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + '</Types>' },
        { name: '_rels/.rels', data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            + '</Relationships>' },
        { name: 'xl/workbook.xml', data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + `<sheets><sheet name="${_xmlEsc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>`
            + '</workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            + '</Relationships>' },
        { name: 'xl/styles.xml', data: _xlsxStylesXml() },
        { name: 'xl/worksheets/sheet1.xml', data: _xlsxSheetXml(matrix, mergeRefs) }
    ];
    const enc = new TextEncoder();
    return _zipStore(files.map(f => ({ name: f.name, data: enc.encode(f.data) })),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// Build the .xlsx and trigger a browser download.
function downloadXlsx(filename, sheetName, matrix, mergeRefs) {
    const blob = _buildXlsxBlob(sheetName, matrix, mergeRefs);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
}

let _crc32Table = null;
function _crc32(bytes) {
    if (!_crc32Table) {
        _crc32Table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            _crc32Table[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ _crc32Table[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Build a ZIP using the "stored" (no compression) method — enough for an .xlsx.
function _zipStore(files, mimeType) {
    const u16 = n => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
    const u32 = n => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
    const cat = arrs => {
        const len = arrs.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const a of arrs) { out.set(a, o); o += a.length; }
        return out;
    };
    const enc = new TextEncoder();

    const locals = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const data = f.data;
        const crc = _crc32(data);
        const local = cat([
            u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
            name, data
        ]);
        locals.push(local);
        central.push(cat([
            u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(crc), u32(data.length), u32(data.length),
            u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
            name
        ]));
        offset += local.length;
    }
    const cd = cat(central);
    const eocd = cat([
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(cd.length), u32(offset), u16(0)
    ]);
    return new Blob([cat([...locals, cd, eocd])], { type: mimeType || 'application/zip' });
}
