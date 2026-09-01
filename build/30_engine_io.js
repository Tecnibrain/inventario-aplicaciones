<script>
"use strict";
/* ============================================================================
   1. UTILIDADES
   ========================================================================== */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const NF = new Intl.NumberFormat('es-CO');
const NF1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const fmt  = n => NF.format(Math.round(n || 0));
const fmt1 = n => NF1.format(n || 0);
const pct  = (a, b) => b ? (100 * a / b) : 0;
const esc  = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Normaliza texto para comparar cabeceras y claves (sin acentos, minusculas). */
function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** Convierte snake_case / kebab del inventario a texto legible. */
function pretty(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  if (s.includes(' / ')) return s.split(' / ').map(pretty).join(' / ');  // clave fabricante/app
  if (!/[a-z]/.test(s) || /\s/.test(s)) return s;          // ya viene formateado
  return s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/\b([a-záéíóúñ])/g, m => m.toUpperCase());
}
/** Minimo y maximo sin difusion: `Math.min(...v)` pasa cada elemento como
 *  argumento y desborda la pila de llamadas a partir de unas decenas de miles. */
function vMin(a) { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
function vMax(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ============================================================================
   2. LECTURA DE ARCHIVO  ·  ZIP + XLSX + CSV, todo en el navegador
   ========================================================================== */

/* ---- 2.1 Descompresion raw-deflate nativa ---- */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Este navegador no admite DecompressionStream, necesario para leer .xlsx. ' +
                    'Usa Chrome/Edge 103+, Firefox 113+ o Safari 16.4+, o exporta el archivo a CSV.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---- 2.2 Lector ZIP (directorio central) ---- */
function readZipEntries(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), n = u8.length;
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido (no se encontró la estructura ZIP).');

  let count = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  // ZIP64
  if (cdOff === 0xFFFFFFFF || count === 0xFFFF) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x07064b50) {
        const z64 = Number(dv.getBigUint64(i + 8, true));
        if (dv.getUint32(z64, true) === 0x06064b50) {
          count = Number(dv.getBigUint64(z64 + 32, true));
          cdOff = Number(dv.getBigUint64(z64 + 48, true));
        }
        break;
      }
    }
  }
  const dec = new TextDecoder('utf-8');
  const entries = new Map();
  let p = cdOff;
  for (let i = 0; i < count && p + 46 <= n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    let lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (csize === 0xFFFFFFFF || lho === 0xFFFFFFFF) {          // extras ZIP64
      let e = p + 46 + nameLen, end = e + extraLen;
      while (e + 4 <= end) {
        const id = dv.getUint16(e, true), sz = dv.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (dv.getUint32(p + 24, true) === 0xFFFFFFFF) q += 8;   // uncompressed
          if (csize === 0xFFFFFFFF) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (lho === 0xFFFFFFFF) lho = Number(dv.getBigUint64(q, true));
          break;
        }
        e += 4 + sz;
      }
    }
    entries.set(name, { method, csize, lho });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { dv, u8, entries };
}

async function zipRead(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const { dv, u8 } = zip;
  if (dv.getUint32(e.lho, true) !== 0x04034b50) return null;
  const nl = dv.getUint16(e.lho + 26, true), el = dv.getUint16(e.lho + 28, true);
  const start = e.lho + 30 + nl + el;
  const raw = u8.subarray(start, start + e.csize);
  const out = e.method === 0 ? raw : await inflateRaw(raw);
  return new TextDecoder('utf-8').decode(out);
}

/* ---- 2.3 XML minimo ---- */
const XENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function xdec(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const c = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return isNaN(c) ? m : String.fromCodePoint(c);
    }
    return XENT[g] != null ? XENT[g] : m;
  });
}
function attrs(tag) {
  const o = {};
  const re = /([a-zA-Z_:][\w:.\-]*)\s*=\s*"([^"]*)"/g;
  let m; while ((m = re.exec(tag))) o[m[1]] = xdec(m[2]);
  return o;
}

/* ---- 2.4 XLSX ---- */
const BUILTIN_DATE_FMT = new Set([14,15,16,17,18,19,20,21,22,27,30,36,45,46,47,50,57]);

function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const reSi = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = reSi.exec(xml))) {
    const inner = m[1] || '';
    if (!inner) { out.push(''); continue; }
    let s = '', t;
    const clean = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const reT = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
    while ((t = reT.exec(clean))) s += xdec(t[1] || '');
    out.push(s);
  }
  return out;
}

function parseStyles(xml) {
  const dateXf = [];
  if (!xml) return dateXf;
  const custom = new Map();
  let m;
  const reFmt = /<numFmt\b([^>]*)\/?>/g;
  while ((m = reFmt.exec(xml))) {
    const a = attrs(m[1]);
    if (a.numFmtId != null) custom.set(+a.numFmtId, a.formatCode || '');
  }
  const cellXfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/);
  if (!cellXfs) return dateXf;
  const reXf = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
  while ((m = reXf.exec(cellXfs[0]))) {
    const id = +(attrs(m[1]).numFmtId || 0);
    let isDate = BUILTIN_DATE_FMT.has(id);
    if (!isDate && custom.has(id)) {
      const code = custom.get(id).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
      isDate = /[ymdhs]/i.test(code) && /[ymd]|h.*m|m.*s/i.test(code);
    }
    dateXf.push(isDate);
  }
  return dateXf;
}

function colToIdx(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}
/** El serial de Excel es una hora de pared sin zona: hay que reconstruirla en
 *  hora local, no como instante UTC, o las marcas de madrugada cambian de dia. */
function excelDate(serial, d1904) {
  const base = d1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const u = new Date(base + Math.round(serial * 86400000));
  if (isNaN(u)) return null;
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(),
                  u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
}

function parseSheet(xml, sst, dateXf, d1904) {
  const rows = [];
  const reRow = /<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let mr;
  while ((mr = reRow.exec(xml))) {
    const body = mr[2];
    const row = [];
    if (body) {
      const reC = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let mc;
      while ((mc = reC.exec(body))) {
        const a = attrs(mc[1]), inner = mc[2] || '';
        const idx = a.r ? colToIdx(a.r) : row.length;
        let val = null;
        const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        if (a.t === 'inlineStr') {
          let s = '', t; const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          while ((t = reT.exec(inner))) s += xdec(t[1]);
          val = s;
        } else if (vm) {
          const raw = xdec(vm[1]);
          if (a.t === 's') val = sst[+raw] != null ? sst[+raw] : '';
          else if (a.t === 'b') val = raw === '1' ? 'VERDADERO' : 'FALSO';
          else if (a.t === 'e') val = '';
          else if (a.t === 'str') val = raw;
          else {
            const num = parseFloat(raw);
            if (!isNaN(num) && a.s != null && dateXf[+a.s]) val = excelDate(num, d1904);
            else val = isNaN(num) ? raw : num;
          }
        }
        if (idx >= 0) row[idx] = val;
      }
    }
    rows.push(row);
  }
  return rows;
}

async function readXlsx(buf) {
  const zip = readZipEntries(buf);
  const wb = await zipRead(zip, 'xl/workbook.xml');
  if (!wb) throw new Error('No se encontró la hoja de cálculo dentro del archivo .xlsx.');
  const d1904 = /date1904\s*=\s*"(1|true)"/i.test(wb);
  const rels = (await zipRead(zip, 'xl/_rels/workbook.xml.rels')) || '';
  const relMap = new Map();
  let m; const reRel = /<Relationship\b([^>]*)\/?>/g;
  while ((m = reRel.exec(rels))) { const a = attrs(m[1]); if (a.Id) relMap.set(a.Id, a.Target); }

  const sheets = [];
  const reSh = /<sheet\b([^>]*)\/?>/g;
  while ((m = reSh.exec(wb))) {
    const a = attrs(m[1]);
    let target = relMap.get(a['r:id'] || a.id || '') || '';
    target = target.replace(/^\/xl\//, '').replace(/^\.\//, '');
    if (!/^xl\//.test(target)) target = 'xl/' + target;
    sheets.push({ name: a.name || ('Hoja ' + (sheets.length + 1)), path: target });
  }
  if (!sheets.length) sheets.push({ name: 'Hoja1', path: 'xl/worksheets/sheet1.xml' });

  const sst = parseSharedStrings(await zipRead(zip, 'xl/sharedStrings.xml'));
  const dateXf = parseStyles(await zipRead(zip, 'xl/styles.xml'));

  // Elige la primera hoja con datos
  for (const sh of sheets) {
    const xml = await zipRead(zip, sh.path);
    if (!xml) continue;
    const rows = parseSheet(xml, sst, dateXf, d1904);
    const useful = rows.filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
    if (useful.length >= 2) return { rows: useful, sheet: sh.name, sheets: sheets.map(s => s.name) };
  }
  throw new Error('El archivo no contiene ninguna hoja con datos.');
}

/* ---- 2.5 CSV / TSV ---- */
function decodeText(buf) {
  let txt = new TextDecoder('utf-8').decode(buf);
  if (txt.indexOf('\uFFFD') >= 0) {
    try { txt = new TextDecoder('windows-1252').decode(buf); } catch (e) { /* deja utf-8 */ }
  }
  return txt.replace(/^\uFEFF/, '');
}
function sniffDelim(txt) {
  const line = (txt.split(/\r?\n/).find(l => l.trim().length) || '');
  let best = ',', bestN = -1;
  for (const d of [',', ';', '\t', '|']) {
    let n = 0, q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === d && !q) n++;
    }
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}
function parseCsv(txt) {
  const d = sniffDelim(txt);
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignora */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

/* ---- 2.6 Fechas en texto ---- */
const MES = { ene:0, enero:0, feb:1, febrero:1, mar:2, marzo:2, abr:3, abril:3, may:4, mayo:4,
  jun:5, junio:5, jul:6, julio:6, ago:7, agosto:7, sep:8, sept:8, septiembre:8, set:8,
  oct:9, octubre:9, nov:10, noviembre:10, dic:11, diciembre:11,
  jan:0, apr:3, aug:7, dec:11 };

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return excelDate(v, false);      // serial Excel
    if (v > 1e11) { const d = new Date(v); return isNaN(d) ? null : d; }
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  // "27 de ago. de 2026 5:24:46"  /  "27 ago 2026"
  let m = s.match(/^(\d{1,2})\s*(?:de\s+)?([a-zA-Záéíóúñ.]+)\.?\s*(?:de\s+)?(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i);
  if (m) {
    const mo = MES[norm(m[2])];
    if (mo != null) return new Date(+m[3], mo, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  // ISO
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  // dd/mm/yyyy  (formato local es-CO)
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
    let dd = +m[1], mm = +m[2];
    if (dd > 12 && mm <= 12) { /* dd/mm */ } else if (mm > 12) { const t = dd; dd = mm; mm = t; }
    return new Date(y, mm - 1, dd, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
/** Compara dos cadenas de version troceandolas en bloques numericos y alfabeticos,
 *  para que 1.10.0 quede por encima de 1.9.0 (un localeCompare lo invertiria). */
const VER_UNK = /^\(sin versión\)$|^(not available|n\/?a|none|null|-)$/i;
function verCmp(a, b) {
  const pa = String(a).match(/\d+|[a-zA-Z]+/g) || [], pb = String(b).match(/\d+|[a-zA-Z]+/g) || [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const d = parseInt(x, 10) - parseInt(y, 10); if (d) return d < 0 ? -1 : 1; }
    else if (nx !== ny) return nx ? 1 : -1;                 // 1.2.3 gana a 1.2.beta
    else { const d = x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0; if (d) return d; }
  }
  return 0;
}
const DAY_MS = 86400000;
const dayKey = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0') : '';
const dayLabel = d => d ? d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';

/* ============================================================================
   17. DATOS GEOGRAFICOS EMBEBIDOS  (Natural Earth 110m simplificado)
   Solo se usan si el archivo cargado trae una columna de ubicacion.
   ========================================================================== */
const WORLD_PATH = 'M120.4 165.0L119.8 166.0L113.7 165.3L120.4 165.0ZM20.8 164.5L16.3 163.6L18.8 163.4L20.8 164.5ZM134.8 163.0L136.1 163.5L136.7 165.0L129.5 166.0L125.8 165.6L131.3 163.0L134.8 163.0ZM58.8 158.5L61.3 158.5L59.8 159.1L57.4 158.7L58.8 158.5ZM81.0 156.9L83.8 157.5L79.2 157.5L77.7 156.9L81.0 156.9ZM111.5 156.0L111.2 157.2L108.9 157.5L105.0 156.7L107.9 156.2L108.3 154.5L109.7 153.9L111.5 156.0ZM121.4 149.2L118.0 149.8L117.4 150.5L117.9 151.2L114.3 153.0L118.2 155.7L119.2 158.7L109.4 161.6L102.8 161.7L106.3 162.9L102.1 163.4L102.0 164.2L121.8 168.2L130.2 166.7L137.2 167.1L151.5 165.3L150.3 164.3L144.4 164.5L144.7 163.1L162.5 160.1L164.3 159.5L163.5 158.9L164.6 158.1L169.7 156.3L172.6 156.7L173.1 155.9L179.8 156.6L187.7 154.9L190.8 155.8L193.4 155.0L207.1 155.5L212.0 154.7L213.9 153.5L218.6 154.8L234.5 150.8L241.4 153.0L248.9 152.9L249.7 154.2L247.8 155.3L249.1 155.7L247.9 156.9L249.9 157.3L253.9 154.9L257.6 154.5L262.8 152.2L266.8 152.2L268.0 151.2L269.7 152.2L275.8 152.4L279.7 152.2L282.8 150.6L286.2 151.9L293.6 150.9L299.8 152.3L314.8 151.2L315.1 150.3L317.5 152.0L325.5 151.9L328.8 153.4L334.3 153.6L341.6 155.6L351.2 156.7L349.3 158.7L346.1 159.4L343.6 161.2L344.7 163.2L347.0 163.8L341.8 164.2L339.8 165.9L349.4 168.8L360.0 169.7L360.0 170.0L0.0 170.0L0.0 169.7L0.9 169.1L10.0 168.9L21.9 170.0L36.9 170.0L26.4 168.7L27.1 167.0L23.2 166.1L29.4 166.3L33.6 165.3L24.7 164.1L21.9 163.0L21.6 161.9L28.7 162.4L33.9 161.5L33.8 160.4L35.1 160.2L66.1 158.7L67.7 159.7L79.4 160.3L79.9 159.9L77.5 159.1L76.3 157.6L83.7 158.6L89.9 158.3L90.8 157.6L98.5 158.9L99.7 158.1L105.1 158.9L112.6 157.5L111.5 154.7L112.6 153.1L112.3 152.3L117.0 149.6L122.2 148.3L122.8 148.5L121.4 149.2ZM112.2 138.8L115.0 139.7L110.8 140.5L105.3 137.8L108.9 139.1L110.7 137.5L112.2 138.8ZM121.5 136.1L122.0 136.9L118.8 136.8L121.5 136.1ZM325.4 125.8L328.3 125.9L327.9 128.2L326.0 128.5L324.7 126.2L325.4 125.8ZM353.0 125.9L354.2 126.3L353.1 128.9L351.5 129.2L349.3 131.6L346.7 131.2L347.0 130.1L353.0 125.9ZM354.6 121.2L356.8 122.9L358.5 122.7L355.2 126.7L354.9 124.9L353.8 124.5L354.7 122.4L352.6 119.5L354.6 121.2ZM230.1 98.6L230.4 100.7L229.7 100.7L227.1 109.9L225.4 110.6L224.0 110.0L223.3 107.1L224.4 105.1L224.4 101.2L227.7 99.6L229.2 97.0L230.1 98.6ZM323.6 98.8L325.4 100.0L326.4 104.0L328.8 105.4L333.1 111.1L332.9 116.6L330.0 122.4L326.3 124.0L325.0 122.9L323.6 123.8L320.6 123.0L319.6 121.1L318.1 120.6L318.2 119.4L316.8 120.3L317.8 117.9L316.0 119.9L314.3 117.6L311.3 116.5L306.1 117.2L303.7 118.9L299.9 119.0L298.0 120.1L295.0 119.2L295.7 116.6L293.3 111.1L294.2 111.3L293.4 109.4L294.1 106.8L294.2 107.5L296.7 105.7L300.9 104.7L303.0 101.4L303.9 102.1L303.5 101.6L305.7 99.2L307.1 98.8L309.6 100.0L310.6 97.5L312.6 97.1L311.8 96.3L312.4 96.1L315.3 97.2L316.5 96.9L317.0 97.4L315.5 100.0L320.2 102.7L321.7 100.0L322.1 96.0L323.6 98.8ZM304.4 95.1L303.5 95.2L304.0 94.3L307.3 93.4L304.4 95.1ZM288.6 91.8L290.8 91.5L295.7 93.4L288.3 92.8L285.4 91.9L286.1 90.9L288.6 91.8ZM332.0 90.5L330.2 91.3L328.3 90.7L330.8 90.5L331.5 89.2L332.3 89.3L332.0 90.5ZM310.5 88.1L310.8 88.9L307.9 88.4L310.5 88.1ZM314.1 86.2L314.4 87.8L315.5 88.4L318.3 86.7L324.6 88.9L327.6 91.1L327.2 92.4L330.7 95.6L327.9 95.1L324.7 92.6L322.6 94.3L319.1 93.1L317.6 93.4L318.7 92.3L317.9 90.4L313.7 88.5L313.0 89.1L312.0 87.8L313.7 87.2L310.5 85.9L312.4 85.4L314.1 86.2ZM305.2 83.6L303.7 84.8L300.2 84.8L300.9 86.4L303.3 85.6L301.5 86.9L303.2 90.3L302.2 90.3L302.7 89.5L301.5 89.6L301.0 87.6L300.3 87.9L300.4 90.5L299.4 90.4L299.5 88.5L298.8 87.8L300.0 84.4L300.9 83.7L305.2 83.6ZM308.7 83.9L308.1 85.9L307.6 83.2L308.7 83.9ZM285.8 90.9L282.6 89.2L275.3 79.5L277.5 79.8L283.8 84.9L283.4 85.7L286.1 88.1L285.8 90.9ZM297.9 83.2L299.0 84.1L297.8 84.2L296.1 89.0L290.2 87.9L289.1 85.5L289.7 83.0L291.2 83.1L291.4 82.3L293.0 81.9L296.7 78.1L299.2 79.6L297.3 81.8L297.9 83.2ZM306.4 76.6L306.5 77.8L306.2 78.7L305.8 77.7L305.4 78.2L305.4 79.4L304.2 78.8L303.6 77.2L301.9 77.8L303.5 76.3L305.5 76.0L305.4 75.2L306.4 76.6ZM261.2 78.8L259.9 78.2L260.1 75.2L261.8 77.5L261.2 78.8ZM298.5 75.7L297.2 76.6L299.5 73.6L298.5 75.7ZM301.3 66.5L302.2 66.5L302.5 67.9L301.7 70.7L304.0 71.2L304.1 72.5L300.6 71.1L301.0 70.5L300.1 70.0L299.9 68.6L301.3 66.5ZM107.4 65.1L111.7 66.4L109.3 66.6L108.6 67.4L106.1 67.0L105.6 66.3L107.7 66.3L106.6 65.4L107.4 65.1ZM100.3 62.2L105.8 64.7L102.2 65.1L102.9 64.6L101.3 63.4L98.2 62.4L95.0 63.1L97.7 61.8L100.3 62.2ZM301.2 62.2L300.7 63.0L300.1 61.4L301.5 59.7L301.2 62.2ZM203.7 49.3L206.3 49.7L204.7 50.1L203.7 49.3ZM195.5 46.8L195.1 48.4L192.4 47.4L195.5 46.8ZM321.0 47.9L320.3 49.9L317.2 50.4L315.8 51.5L315.1 50.4L311.0 51.1L312.0 51.9L311.3 53.5L310.2 53.6L310.4 52.7L309.4 51.7L312.6 49.6L315.7 49.5L316.7 47.7L317.4 48.2L319.4 46.8L320.3 43.8L321.4 43.6L321.9 45.0L321.0 47.9ZM323.9 40.8L325.3 40.6L325.5 41.7L323.2 43.0L321.6 42.3L321.1 43.4L320.0 43.4L319.8 42.4L321.4 41.6L322.0 39.4L323.9 40.8ZM56.5 36.5L54.3 36.2L51.6 34.2L54.2 34.7L56.5 36.5ZM123.9 34.3L123.2 35.2L126.5 35.8L126.2 36.5L126.9 36.3L127.4 37.5L126.9 38.3L125.8 38.2L125.8 37.2L124.6 38.1L123.7 37.4L120.7 37.4L122.6 34.3L124.1 33.4L123.9 34.3ZM323.6 34.3L324.7 36.0L323.2 35.7L322.6 37.1L323.5 38.9L322.7 38.3L322.1 39.0L321.7 31.7L322.7 30.6L323.6 34.3ZM173.2 32.7L170.0 33.2L170.8 32.1L170.3 31.1L173.3 29.8L174.3 30.4L173.2 32.7ZM27.0 27.9L26.0 28.3L25.3 27.5L27.4 27.1L27.0 27.9ZM177.0 26.4L175.9 27.4L178.0 27.3L176.9 29.0L181.7 32.3L181.4 33.7L174.8 35.0L176.6 33.6L174.7 33.0L175.8 32.7L175.4 31.5L177.1 31.0L175.2 30.2L175.0 29.2L174.4 29.7L173.9 28.2L175.0 26.4L177.0 26.4ZM94.8 19.3L99.9 21.3L92.8 21.5L94.1 19.3L94.8 19.3ZM165.5 18.5L165.3 19.2L166.4 19.9L161.3 21.5L157.2 21.0L158.2 20.6L156.0 20.1L157.8 19.6L155.7 19.4L157.9 18.6L159.4 19.3L165.5 18.5ZM5.0 18.4L8.1 18.1L10.1 19.0L7.5 19.6L7.0 20.7L1.6 19.6L1.3 18.9L0.1 19.1L0.0 20.0L0.0 16.0L5.1 17.8L5.0 18.4ZM84.4 15.9L80.2 15.6L81.8 14.9L84.4 15.9ZM89.5 15.5L89.4 16.5L90.8 15.7L92.6 17.8L94.4 16.2L94.5 15.1L97.4 15.3L98.7 15.8L98.0 16.9L98.7 17.4L96.7 18.6L94.2 18.4L92.7 20.2L86.8 23.0L85.3 26.1L86.8 26.2L87.7 27.9L97.7 29.9L97.9 31.7L100.1 33.8L101.4 32.4L100.2 30.3L103.5 28.5L101.5 26.2L102.7 25.1L101.9 22.7L106.2 22.6L110.4 23.9L110.7 26.0L112.4 26.8L115.4 24.7L118.6 28.0L118.2 28.7L122.7 30.4L124.2 31.7L124.3 32.9L120.0 34.8L113.6 34.8L108.9 38.2L114.9 35.8L115.8 36.3L114.9 36.9L115.5 38.8L118.5 39.1L119.5 38.0L120.2 39.1L114.6 41.5L113.8 40.5L115.6 39.7L112.9 39.9L109.3 42.0L110.0 43.4L106.3 44.1L108.1 44.1L106.0 44.2L105.1 46.1L104.5 45.5L104.9 46.6L104.1 47.8L103.7 45.8L103.7 46.9L103.0 46.8L104.3 49.4L98.7 53.6L99.9 58.1L99.6 59.8L98.3 59.1L95.9 54.9L90.8 54.7L90.8 55.7L89.8 55.9L86.2 55.3L83.4 56.7L82.6 57.6L82.1 62.6L83.7 65.7L85.6 66.9L88.0 66.3L89.2 65.7L89.7 64.0L92.9 63.5L91.1 69.1L96.6 69.7L96.2 73.9L98.6 76.2L100.4 75.4L103.2 76.4L105.1 73.9L108.2 72.6L108.9 72.9L108.1 73.6L108.3 75.9L108.6 74.0L110.1 72.8L111.8 74.4L115.1 74.9L118.1 74.3L117.6 75.1L122.9 79.0L126.0 79.2L128.7 80.8L130.0 83.3L129.6 85.1L131.4 85.2L131.4 86.2L132.2 85.6L135.1 86.6L135.4 87.7L140.0 87.9L144.4 90.1L145.3 92.3L144.9 94.0L141.3 98.1L140.7 102.9L139.1 106.9L132.4 109.9L131.1 113.7L126.2 119.4L123.8 119.9L121.6 118.9L123.2 121.9L120.8 123.7L117.7 123.8L117.3 126.0L114.9 126.1L115.0 127.1L116.5 127.6L114.8 128.5L114.4 130.0L112.7 130.6L112.4 131.3L114.4 132.2L114.0 133.1L110.9 135.7L111.8 137.3L109.2 137.9L109.0 138.8L105.1 137.3L104.4 133.7L105.9 131.9L104.4 131.6L105.6 129.1L106.8 129.5L107.3 127.4L105.7 128.2L106.8 124.3L106.4 122.2L108.6 117.4L109.8 104.8L108.5 102.4L104.0 99.6L100.2 92.2L98.8 91.1L98.6 89.7L100.2 87.7L99.0 87.2L99.1 86.1L102.9 81.2L101.8 76.7L100.4 76.1L99.1 77.8L94.3 75.1L92.5 71.7L88.8 71.1L85.3 68.8L83.4 69.3L76.5 66.7L74.5 65.1L74.0 62.2L66.1 53.4L65.2 53.2L65.3 54.8L70.6 61.6L70.0 62.2L67.8 60.3L67.7 59.0L64.9 57.3L65.8 56.4L62.7 52.0L59.4 50.4L55.6 44.7L56.1 39.5L55.3 36.8L56.9 37.0L57.4 37.9L57.2 36.0L52.6 34.2L52.1 32.7L50.9 32.2L45.9 26.9L32.9 24.1L28.3 25.8L29.4 23.7L26.0 25.6L26.7 26.1L25.8 26.9L21.6 29.0L15.2 30.6L22.3 27.4L23.0 26.1L18.0 26.3L18.1 25.4L16.2 25.2L13.9 23.5L15.4 21.9L19.2 21.2L18.5 20.6L19.2 20.2L15.0 20.6L11.9 19.3L15.5 18.4L18.3 18.9L13.2 16.6L23.4 13.6L43.5 16.1L51.9 14.5L54.2 15.5L55.6 14.8L55.7 15.6L58.5 15.2L64.8 16.1L66.1 16.6L64.7 17.1L71.1 17.6L72.2 17.1L71.2 16.7L71.8 16.3L73.8 16.2L78.5 17.4L81.6 17.2L82.3 16.4L83.9 16.8L83.9 17.7L85.8 15.9L83.5 14.9L83.6 13.8L84.8 13.1L87.1 13.7L88.5 14.8L87.6 15.3L89.5 15.5ZM65.8 11.9L65.3 12.3L68.9 12.5L70.1 12.0L71.8 13.3L72.3 12.9L71.6 11.9L73.5 11.9L75.5 14.0L78.9 15.4L77.3 15.5L77.6 16.2L63.9 15.8L62.7 15.0L67.6 14.6L62.1 14.5L63.9 13.7L60.6 13.4L62.1 12.3L65.8 11.9ZM93.4 11.8L94.2 12.5L97.7 11.2L99.4 12.3L99.3 12.9L102.2 12.3L105.9 13.7L107.8 13.4L112.1 14.9L113.0 15.8L111.2 16.3L118.1 18.1L116.1 20.0L112.0 18.7L115.3 21.6L115.0 22.3L111.2 21.3L113.8 23.1L105.2 20.3L102.3 20.8L101.4 20.4L102.1 19.7L106.0 19.5L107.1 17.3L101.0 14.8L91.3 14.6L90.5 14.2L91.5 13.8L90.1 13.8L89.8 12.8L91.6 11.5L94.2 11.2L93.4 11.8ZM79.6 11.2L82.6 11.2L81.9 12.0L83.5 12.4L83.3 13.3L80.7 13.6L77.5 12.5L79.6 12.3L78.5 11.6L79.6 11.2ZM323.6 11.8L319.9 11.6L322.1 11.1L323.6 11.8ZM86.8 12.2L84.6 12.9L84.0 11.6L85.5 10.9L89.5 11.1L86.8 12.2ZM59.5 13.6L56.9 14.1L54.1 13.1L56.1 11.3L55.1 10.7L62.4 10.8L64.5 11.5L60.8 12.5L59.5 13.6ZM86.4 10.0L83.2 10.1L85.1 9.4L86.4 10.0ZM325.1 9.4L324.3 10.2L319.0 10.4L317.0 9.7L318.8 8.9L325.1 9.4ZM81.5 8.3L82.3 8.7L81.8 10.0L77.5 9.4L77.4 8.7L81.5 8.3ZM71.8 8.8L74.1 9.0L73.7 10.0L66.3 10.6L68.2 9.8L62.3 9.8L64.6 8.5L70.9 9.5L69.5 8.6L71.8 8.8ZM237.5 14.3L231.6 13.5L235.6 9.9L241.2 8.7L248.9 8.5L238.5 10.7L235.4 12.6L237.5 14.3ZM85.3 7.9L90.8 9.4L98.9 9.3L100.2 10.1L87.6 10.2L86.1 8.7L82.9 8.2L85.3 7.9ZM63.8 7.4L62.9 8.5L57.1 8.9L63.8 7.4ZM287.0 8.0L294.1 9.2L289.4 10.8L303.2 12.0L303.3 11.3L307.0 11.4L311.3 14.2L312.3 13.2L319.9 13.5L319.1 12.6L320.5 12.2L329.5 12.8L333.0 14.2L339.0 14.1L340.9 15.6L347.8 15.4L349.6 16.3L350.8 16.0L350.0 15.3L350.5 14.9L358.6 15.6L360.0 16.0L360.0 20.0L357.4 20.4L359.5 22.4L353.7 23.3L350.3 25.1L348.9 24.4L343.5 25.1L342.0 26.8L343.2 27.4L342.1 30.1L340.4 30.7L340.0 31.8L338.5 32.0L336.8 34.0L335.4 29.6L335.9 28.2L343.7 23.9L344.5 22.4L340.1 24.5L339.3 23.2L336.7 23.6L334.2 25.2L335.0 25.9L331.3 26.2L331.3 25.5L329.8 25.3L322.2 26.0L315.1 30.3L318.2 31.2L319.9 30.8L321.4 32.8L320.1 36.6L318.2 38.7L314.9 41.6L312.3 41.7L307.5 45.2L309.5 48.2L309.1 49.9L306.5 50.6L306.1 48.3L306.9 48.1L304.7 46.9L305.3 45.4L301.1 46.1L302.2 44.6L301.6 44.1L298.0 45.8L297.5 46.3L298.9 47.6L302.4 47.5L299.2 50.1L301.9 53.3L301.3 54.3L302.1 55.2L301.7 56.8L298.7 60.5L295.9 62.2L290.8 63.6L290.4 64.7L288.5 63.3L285.9 65.2L289.3 71.6L289.2 73.3L285.2 76.4L285.1 75.1L280.1 71.6L279.2 75.8L283.0 79.5L284.2 83.7L281.4 82.2L280.1 78.5L278.5 76.6L278.3 77.2L278.8 73.6L277.2 68.1L275.4 69.3L274.2 69.0L274.3 66.8L271.4 62.2L270.5 62.2L270.3 63.2L267.0 63.5L266.5 64.8L260.3 69.1L259.9 74.6L257.5 77.0L253.5 69.0L252.6 63.6L250.5 64.1L246.4 59.6L237.4 59.3L236.5 57.9L234.7 58.5L231.5 57.1L230.1 54.9L228.0 55.0L230.8 60.2L231.0 59.0L231.6 59.2L231.8 61.0L234.0 60.9L236.4 58.6L236.8 60.8L239.8 62.7L237.8 64.8L237.7 66.1L235.3 67.8L228.7 71.0L223.5 72.4L222.6 68.2L219.1 63.7L218.5 61.3L214.6 56.9L214.9 55.5L213.9 57.4L212.4 55.1L215.5 61.9L216.9 63.0L217.5 66.4L223.3 72.6L222.7 73.3L224.6 74.6L231.1 73.0L231.0 74.4L227.7 80.8L220.3 87.6L219.2 89.7L218.8 91.5L220.5 95.8L220.8 99.7L219.5 101.7L214.8 104.8L215.6 108.7L212.6 110.7L212.2 113.8L208.2 117.8L205.8 118.9L199.6 119.8L198.4 119.1L198.2 116.7L195.2 112.1L194.3 107.1L191.8 103.1L191.8 100.8L193.7 95.7L191.9 90.0L188.8 86.1L189.4 81.3L188.5 80.2L185.9 80.7L184.3 78.7L178.0 80.3L171.0 80.2L167.6 77.7L163.4 72.8L162.4 70.3L163.9 66.9L163.0 63.1L165.6 58.7L170.4 55.1L170.7 52.4L174.1 49.2L177.8 49.8L181.5 48.4L189.5 47.6L191.1 48.1L190.3 51.2L199.1 54.7L200.1 52.8L201.5 52.2L208.9 54.1L211.0 53.4L213.8 54.0L216.0 50.4L216.2 48.3L207.6 48.3L206.2 45.5L209.2 43.8L213.5 43.0L218.3 44.1L221.7 43.0L216.7 39.8L219.1 37.7L215.0 38.7L216.3 39.9L213.9 40.6L212.5 39.7L213.3 38.9L210.7 38.4L207.7 42.4L208.8 43.9L206.4 44.8L204.9 44.1L203.7 44.3L203.9 45.0L202.6 44.7L204.0 47.3L203.1 47.1L203.2 48.6L202.5 48.6L199.4 44.7L199.5 43.3L193.1 39.3L192.3 39.6L192.6 40.9L198.5 44.8L196.9 44.6L197.1 46.1L196.1 47.0L195.4 45.0L188.9 40.6L186.5 41.9L183.1 41.9L183.0 43.1L180.8 44.0L180.1 46.3L177.9 48.3L174.6 49.1L173.5 48.1L171.1 48.1L170.6 42.0L178.6 41.0L178.8 39.0L175.4 36.3L178.4 36.4L178.1 35.2L181.3 34.9L184.7 31.9L188.1 31.5L188.8 31.0L188.1 29.5L188.5 27.9L190.6 27.3L190.9 28.5L189.7 29.5L190.9 31.0L199.7 30.6L201.3 29.8L201.6 27.6L204.1 28.0L204.4 26.6L203.3 25.8L209.1 25.0L202.9 25.2L201.3 24.3L201.5 21.8L205.4 19.9L203.9 19.0L202.2 19.3L201.4 20.6L197.8 22.3L197.1 23.7L198.8 24.9L196.8 26.3L195.9 28.9L192.9 29.6L190.4 25.5L188.4 26.7L185.7 26.4L185.0 23.0L190.5 20.5L194.8 17.2L204.5 14.0L208.2 13.8L211.3 14.5L210.0 14.8L211.1 15.4L220.3 17.1L221.1 18.2L220.0 18.7L213.2 18.4L214.8 19.1L214.9 20.6L217.0 21.2L216.5 20.2L217.2 19.9L219.6 20.5L220.4 20.2L219.8 19.5L222.1 18.5L223.9 18.9L224.5 18.2L223.5 16.4L226.3 16.7L226.8 17.3L225.6 18.0L226.3 18.3L233.7 16.1L234.5 16.2L233.5 16.8L238.8 16.1L239.9 16.7L241.1 16.1L240.0 15.5L240.6 15.1L248.5 16.9L249.2 16.4L246.9 15.5L246.7 14.0L249.2 12.2L252.6 12.2L251.8 13.6L252.8 14.6L252.6 16.0L253.7 16.6L251.3 18.7L252.4 18.8L255.1 17.2L254.9 16.0L253.6 15.4L254.4 14.4L253.1 13.6L254.9 12.9L254.7 12.2L255.7 12.7L255.3 13.7L256.4 13.8L255.9 13.1L257.6 12.7L261.5 13.2L260.5 11.4L266.8 11.1L266.0 10.5L267.2 9.9L280.8 8.6L284.4 7.3L287.0 8.0ZM229.1 43.7L230.4 44.7L228.9 46.2L229.2 47.4L233.8 48.0L233.9 46.0L232.7 45.0L232.9 44.1L234.7 44.0L233.7 42.9L232.8 43.9L232.5 42.2L230.3 40.4L233.0 39.7L233.0 38.1L229.1 38.6L226.7 40.4L229.1 43.7ZM204.7 7.1L200.7 7.3L202.9 6.5L204.7 7.1ZM84.2 6.9L81.9 6.9L81.4 6.1L84.2 6.9ZM79.9 6.7L74.8 6.6L75.8 6.3L74.5 5.7L79.9 6.7ZM285.1 6.7L279.4 7.1L282.1 5.7L285.1 6.7ZM198.3 5.3L201.5 6.0L195.9 8.2L190.4 5.3L198.3 5.3ZM205.4 4.6L207.4 4.9L203.0 5.6L197.4 4.7L205.4 4.6ZM231.1 4.5L227.6 5.0L224.8 4.4L231.1 4.5ZM279.9 6.1L275.0 6.0L271.2 4.7L275.9 3.7L280.2 5.2L279.9 6.1ZM93.0 5.3L94.2 5.7L89.2 6.8L83.3 4.8L87.6 3.7L93.0 5.3ZM111.5 1.9L118.1 2.6L112.3 3.5L114.5 3.5L108.8 5.2L103.1 5.7L104.6 6.5L100.2 7.8L102.1 8.2L99.4 8.8L90.5 8.5L92.2 7.8L91.7 7.1L95.0 7.5L92.0 6.6L94.9 5.7L93.1 4.7L98.2 4.5L92.4 4.5L88.4 3.1L100.7 1.9L111.5 1.9ZM152.9 1.5L159.2 2.3L148.6 3.0L157.1 2.9L157.9 3.3L156.8 3.8L164.2 3.1L167.8 3.7L160.0 4.8L162.3 4.9L160.3 6.2L160.3 7.4L161.5 8.0L158.3 8.4L160.2 8.9L160.4 9.8L159.3 9.8L160.6 10.7L156.4 11.7L157.7 12.8L155.2 12.7L158.2 14.3L154.5 13.6L154.8 14.2L153.6 14.8L157.7 14.9L140.2 19.5L137.2 22.3L137.6 23.1L136.6 24.9L131.7 24.1L128.4 21.4L126.0 17.8L129.1 15.1L125.3 15.4L125.6 14.2L128.6 14.4L124.2 13.3L125.3 12.4L121.4 9.5L111.5 8.9L108.6 8.0L113.2 7.6L106.7 7.0L114.3 5.6L112.0 4.9L117.8 3.7L117.3 3.2L129.6 2.6L135.5 3.3L133.2 2.4L136.6 1.8L152.9 1.5Z';
const GEO = {"fiji":[177.98,-17.83],"fiyi":[177.98,-17.83],"fj":[177.98,-17.83],"fji":[177.98,-17.83],"tanzania":[34.96,-6.05],"unitedrepublicoftanzania":[34.96,-6.05],"tz":[34.96,-6.05],"tza":[34.96,-6.05],"westernsahara":[-12.63,23.97],"saharaoccidental":[-12.63,23.97],"wsahara":[-12.63,23.97],"eh":[-12.63,23.97],"esh":[-12.63,23.97],"canada":[-101.91,60.32],"ca":[-101.91,60.32],"can":[-101.91,60.32],"unitedstatesofamerica":[-97.48,39.54],"estadosunidos":[-97.48,39.54],"unitedstates":[-97.48,39.54],"us":[-97.48,39.54],"usa":[-97.48,39.54],"kazakhstan":[68.69,49.05],"kazajistan":[68.69,49.05],"kz":[68.69,49.05],"kaz":[68.69,49.05],"uzbekistan":[64.01,41.69],"uz":[64.01,41.69],"uzb":[64.01,41.69],"papuanewguinea":[143.91,-5.7],"papuanuevaguinea":[143.91,-5.7],"pg":[143.91,-5.7],"png":[143.91,-5.7],"indonesia":[101.89,-0.95],"id":[101.89,-0.95],"idn":[101.89,-0.95],"argentina":[-64.17,-33.5],"ar":[-64.17,-33.5],"arg":[-64.17,-33.5],"chile":[-72.32,-38.15],"cl":[-72.32,-38.15],"chl":[-72.32,-38.15],"democraticrepublicofthecongo":[23.46,-1.86],"republicademocraticadelcongo":[23.46,-1.86],"demrepcongo":[23.46,-1.86],"cd":[23.46,-1.86],"cod":[23.46,-1.86],"somalia":[45.19,3.57],"so":[45.19,3.57],"som":[45.19,3.57],"kenya":[37.91,0.55],"kenia":[37.91,0.55],"ke":[37.91,0.55],"ken":[37.91,0.55],"sudan":[29.26,16.33],"sd":[29.26,16.33],"sdn":[29.26,16.33],"chad":[18.65,15.14],"td":[18.65,15.14],"tcd":[18.65,15.14],"haiti":[-72.22,19.26],"ht":[-72.22,19.26],"hti":[-72.22,19.26],"dominicanrepublic":[-70.65,19.1],"republicadominicana":[-70.65,19.1],"dominicanrep":[-70.65,19.1],"do":[-70.65,19.1],"dom":[-70.65,19.1],"russia":[44.69,58.25],"rusia":[44.69,58.25],"russianfederation":[44.69,58.25],"ru":[44.69,58.25],"rus":[44.69,58.25],"thebahamas":[-77.15,26.4],"bahamas":[-77.15,26.4],"bs":[-77.15,26.4],"bhs":[-77.15,26.4],"falklandislands":[-58.74,-51.61],"islasmalvinas":[-58.74,-51.61],"falklandis":[-58.74,-51.61],"falklandislandsmalvinas":[-58.74,-51.61],"fk":[-58.74,-51.61],"flk":[-58.74,-51.61],"norway":[9.68,61.36],"noruega":[9.68,61.36],"no":[9.68,61.36],"nor":[9.68,61.36],"greenland":[-39.34,74.32],"groenlandia":[-39.34,74.32],"gl":[-39.34,74.32],"grl":[-39.34,74.32],"frenchsouthernandantarcticlands":[69.12,-49.3],"tierrasaustralesyantarticasfrancesas":[69.12,-49.3],"frsantarcticlands":[69.12,-49.3],"tf":[69.12,-49.3],"atf":[69.12,-49.3],"easttimor":[125.85,-8.8],"timororiental":[125.85,-8.8],"timorleste":[125.85,-8.8],"tl":[125.85,-8.8],"tls":[125.85,-8.8],"southafrica":[23.67,-29.71],"sudafrica":[23.67,-29.71],"za":[23.67,-29.71],"zaf":[23.67,-29.71],"lesotho":[28.25,-29.48],"lesoto":[28.25,-29.48],"ls":[28.25,-29.48],"lso":[28.25,-29.48],"mexico":[-102.29,23.92],"mx":[-102.29,23.92],"mex":[-102.29,23.92],"uruguay":[-55.97,-32.96],"uy":[-55.97,-32.96],"ury":[-55.97,-32.96],"brazil":[-49.56,-12.1],"brasil":[-49.56,-12.1],"br":[-49.56,-12.1],"bra":[-49.56,-12.1],"bolivia":[-64.59,-16.67],"bo":[-64.59,-16.67],"bol":[-64.59,-16.67],"peru":[-72.9,-12.98],"pe":[-72.9,-12.98],"per":[-72.9,-12.98],"colombia":[-73.17,3.37],"co":[-73.17,3.37],"col":[-73.17,3.37],"panama":[-79.52,8.98],"pa":[-80.35,8.72],"pan":[-80.35,8.72],"costarica":[-84.08,10.07],"cr":[-84.08,10.07],"cri":[-84.08,10.07],"nicaragua":[-85.07,12.67],"ni":[-85.07,12.67],"nic":[-85.07,12.67],"honduras":[-86.89,14.79],"hn":[-86.89,14.79],"hnd":[-86.89,14.79],"elsalvador":[-88.89,13.69],"sv":[-88.89,13.69],"slv":[-88.89,13.69],"guatemala":[-90.51,14.63],"gt":[-90.5,14.98],"gtm":[-90.5,14.98],"belize":[-88.71,17.2],"belice":[-88.71,17.2],"bz":[-88.71,17.2],"blz":[-88.71,17.2],"venezuela":[-64.6,7.18],"ve":[-64.6,7.18],"ven":[-64.6,7.18],"guyana":[-58.94,5.12],"gy":[-58.94,5.12],"guy":[-58.94,5.12],"suriname":[-55.91,4.14],"surinam":[-55.91,4.14],"sr":[-55.91,4.14],"sur":[-55.91,4.14],"france":[2.55,46.7],"francia":[2.55,46.7],"fr":[2.55,46.7],"fra":[2.55,46.7],"ecuador":[-78.19,-1.26],"ec":[-78.19,-1.26],"ecu":[-78.19,-1.26],"puertorico":[-66.48,18.23],"pr":[-66.48,18.23],"pri":[-66.48,18.23],"jamaica":[-77.32,18.14],"jm":[-77.32,18.14],"jam":[-77.32,18.14],"cuba":[-77.98,21.33],"cu":[-77.98,21.33],"cub":[-77.98,21.33],"zimbabwe":[29.93,-18.91],"zimbabue":[29.93,-18.91],"zw":[29.93,-18.91],"zwe":[29.93,-18.91],"botswana":[24.18,-22.1],"botsuana":[24.18,-22.1],"bw":[24.18,-22.1],"bwa":[24.18,-22.1],"namibia":[17.11,-20.58],"na":[17.11,-20.58],"nam":[17.11,-20.58],"senegal":[-14.78,15.14],"sn":[-14.78,15.14],"sen":[-14.78,15.14],"mali":[-2.04,18.69],"ml":[-2.04,18.69],"mli":[-2.04,18.69],"mauritania":[-9.74,19.59],"mr":[-9.74,19.59],"mrt":[-9.74,19.59],"benin":[2.35,10.32],"bj":[2.35,10.32],"ben":[2.35,10.32],"niger":[9.5,17.45],"ne":[9.5,17.45],"ner":[9.5,17.45],"nigeria":[7.5,9.44],"ng":[7.5,9.44],"nga":[7.5,9.44],"cameroon":[12.47,4.59],"camerun":[12.47,4.59],"cm":[12.47,4.59],"cmr":[12.47,4.59],"togo":[1.06,8.81],"tg":[1.06,8.81],"tgo":[1.06,8.81],"ghana":[-1.04,7.72],"gh":[-1.04,7.72],"gha":[-1.04,7.72],"ivorycoast":[-5.57,7.49],"costademarfil":[-5.57,7.49],"cotedivoire":[-5.57,7.49],"ci":[-5.57,7.49],"civ":[-5.57,7.49],"guinea":[-10.02,10.62],"gn":[-10.02,10.62],"gin":[-10.02,10.62],"guineabissau":[-14.52,12.16],"guineabisau":[-14.52,12.16],"gw":[-14.52,12.16],"gnb":[-14.52,12.16],"liberia":[-9.46,6.45],"lr":[-9.46,6.45],"lbr":[-9.46,6.45],"sierraleone":[-11.76,8.62],"sierraleona":[-11.76,8.62],"sl":[-11.76,8.62],"sle":[-11.76,8.62],"burkinafaso":[-1.36,12.67],"bf":[-1.36,12.67],"bfa":[-1.36,12.67],"centralafricanrepublic":[20.91,6.99],"republicacentroafricana":[20.91,6.99],"centralafricanrep":[20.91,6.99],"cf":[20.91,6.99],"caf":[20.91,6.99],"republicofthecongo":[15.9,0.14],"republicadelcongo":[15.9,0.14],"congo":[15.9,0.14],"cg":[15.9,0.14],"cog":[15.9,0.14],"gabon":[11.84,-0.44],"ga":[11.84,-0.44],"gab":[11.84,-0.44],"equatorialguinea":[8.99,2.33],"guineaecuatorial":[8.99,2.33],"eqguinea":[8.99,2.33],"gq":[8.99,2.33],"gnq":[8.99,2.33],"zambia":[26.4,-14.66],"zm":[26.4,-14.66],"zmb":[26.4,-14.66],"malawi":[33.61,-13.39],"malaui":[33.61,-13.39],"mw":[33.61,-13.39],"mwi":[33.61,-13.39],"mozambique":[37.84,-13.94],"mz":[37.84,-13.94],"moz":[37.84,-13.94],"eswatini":[31.47,-26.53],"suazilandia":[31.47,-26.53],"kingdomofeswatini":[31.47,-26.53],"sz":[31.47,-26.53],"swz":[31.47,-26.53],"angola":[17.98,-12.18],"ao":[17.98,-12.18],"ago":[17.98,-12.18],"burundi":[29.92,-3.33],"bi":[29.92,-3.33],"bdi":[29.92,-3.33],"israel":[34.85,30.91],"il":[34.85,30.91],"isr":[34.85,30.91],"lebanon":[35.99,34.13],"libano":[35.99,34.13],"lb":[35.99,34.13],"lbn":[35.99,34.13],"madagascar":[46.7,-18.63],"mg":[46.7,-18.63],"mdg":[46.7,-18.63],"palestine":[35.29,32.05],"palestina":[35.29,32.05],"ps":[35.29,32.05],"pse":[35.29,32.05],"thegambia":[-15.0,13.64],"gambia":[-15.0,13.64],"gm":[-15.0,13.64],"gmb":[-15.0,13.64],"tunisia":[9.01,33.69],"tunez":[9.01,33.69],"tn":[9.01,33.69],"tun":[9.01,33.69],"algeria":[2.81,27.4],"argelia":[2.81,27.4],"dz":[2.81,27.4],"dza":[2.81,27.4],"jordan":[36.38,30.81],"jordania":[36.38,30.81],"jo":[36.38,30.81],"jor":[36.38,30.81],"unitedarabemirates":[54.55,23.47],"emiratosarabesunidos":[54.55,23.47],"ae":[54.55,23.47],"are":[54.55,23.47],"qatar":[51.14,25.24],"catar":[51.14,25.24],"qa":[51.14,25.24],"qat":[51.14,25.24],"kuwait":[47.31,29.41],"kw":[47.31,29.41],"kwt":[47.31,29.41],"iraq":[43.26,33.09],"irak":[43.26,33.09],"iq":[43.26,33.09],"irq":[43.26,33.09],"oman":[57.34,22.12],"om":[57.34,22.12],"omn":[57.34,22.12],"vanuatu":[166.91,-15.37],"vu":[166.91,-15.37],"vut":[166.91,-15.37],"cambodia":[104.5,12.65],"camboya":[104.5,12.65],"kh":[104.5,12.65],"khm":[104.5,12.65],"thailand":[101.07,15.46],"tailandia":[101.07,15.46],"th":[101.07,15.46],"tha":[101.07,15.46],"laos":[102.53,19.43],"laopdr":[102.53,19.43],"la":[102.53,19.43],"lao":[102.53,19.43],"myanmar":[95.8,21.57],"birmania":[95.8,21.57],"mm":[95.8,21.57],"mmr":[95.8,21.57],"vietnam":[105.39,21.72],"vn":[105.39,21.72],"vnm":[105.39,21.72],"northkorea":[126.44,39.89],"coreadelnorte":[126.44,39.89],"demrepkorea":[126.44,39.89],"kp":[126.44,39.89],"prk":[126.44,39.89],"southkorea":[128.13,36.38],"coreadelsur":[128.13,36.38],"republicofkorea":[128.13,36.38],"kr":[128.13,36.38],"kor":[128.13,36.38],"mongolia":[104.15,46.0],"mn":[104.15,46.0],"mng":[104.15,46.0],"india":[79.36,22.69],"in":[79.36,22.69],"ind":[79.36,22.69],"bangladesh":[89.68,24.21],"banglades":[89.68,24.21],"bd":[89.68,24.21],"bgd":[89.68,24.21],"bhutan":[90.04,27.54],"butan":[90.04,27.54],"bt":[90.04,27.54],"btn":[90.04,27.54],"nepal":[83.64,28.3],"np":[83.64,28.3],"npl":[83.64,28.3],"pakistan":[68.55,29.33],"pk":[68.55,29.33],"pak":[68.55,29.33],"afghanistan":[66.5,34.16],"afganistan":[66.5,34.16],"af":[66.5,34.16],"afg":[66.5,34.16],"tajikistan":[72.59,38.2],"tayikistan":[72.59,38.2],"tj":[72.59,38.2],"tjk":[72.59,38.2],"kyrgyzstan":[74.53,41.67],"kirguistan":[74.53,41.67],"kg":[74.53,41.67],"kgz":[74.53,41.67],"turkmenistan":[58.68,39.86],"tm":[58.68,39.86],"tkm":[58.68,39.86],"iran":[54.93,32.17],"ir":[54.93,32.17],"irn":[54.93,32.17],"syria":[38.28,35.01],"siria":[38.28,35.01],"sy":[38.28,35.01],"syr":[38.28,35.01],"armenia":[-75.68,4.53],"am":[44.8,40.46],"arm":[44.8,40.46],"sweden":[19.02,65.86],"suecia":[19.02,65.86],"se":[19.02,65.86],"swe":[19.02,65.86],"belarus":[28.42,53.82],"bielorrusia":[28.42,53.82],"by":[28.42,53.82],"blr":[28.42,53.82],"ukraine":[32.14,49.72],"ucrania":[32.14,49.72],"ua":[32.14,49.72],"ukr":[32.14,49.72],"poland":[19.49,51.99],"polonia":[19.49,51.99],"pl":[19.49,51.99],"pol":[19.49,51.99],"austria":[14.13,47.52],"at":[14.13,47.52],"aut":[14.13,47.52],"hungary":[19.45,47.09],"hungria":[19.45,47.09],"hu":[19.45,47.09],"hun":[19.45,47.09],"moldova":[28.49,47.43],"moldavia":[28.49,47.43],"md":[28.49,47.43],"mda":[28.49,47.43],"romania":[24.97,45.73],"rumania":[24.97,45.73],"ro":[24.97,45.73],"rou":[24.97,45.73],"lithuania":[24.09,55.1],"lituania":[24.09,55.1],"lt":[24.09,55.1],"ltu":[24.09,55.1],"latvia":[25.46,57.07],"letonia":[25.46,57.07],"lv":[25.46,57.07],"lva":[25.46,57.07],"estonia":[25.87,58.72],"ee":[25.87,58.72],"est":[25.87,58.72],"germany":[9.68,50.96],"alemania":[9.68,50.96],"de":[9.68,50.96],"deu":[9.68,50.96],"bulgaria":[25.16,42.51],"bg":[25.16,42.51],"bgr":[25.16,42.51],"greece":[21.73,39.49],"grecia":[21.73,39.49],"gr":[21.73,39.49],"grc":[21.73,39.49],"turkey":[34.51,39.35],"turquia":[34.51,39.35],"tr":[34.51,39.35],"tur":[34.51,39.35],"albania":[20.11,40.65],"al":[20.11,40.65],"alb":[20.11,40.65],"croatia":[16.37,45.81],"croacia":[16.37,45.81],"hr":[16.37,45.81],"hrv":[16.37,45.81],"switzerland":[7.46,46.72],"suiza":[7.46,46.72],"ch":[7.46,46.72],"che":[7.46,46.72],"luxembourg":[6.08,49.73],"luxemburgo":[6.08,49.73],"lu":[6.08,49.73],"lux":[6.08,49.73],"belgium":[4.8,50.79],"belgica":[4.8,50.79],"be":[4.8,50.79],"bel":[4.8,50.79],"netherlands":[5.61,52.42],"paisesbajos":[5.61,52.42],"nl":[5.61,52.42],"nld":[5.61,52.42],"portugal":[-8.27,39.61],"pt":[-8.27,39.61],"prt":[-8.27,39.61],"spain":[-3.46,40.09],"espana":[-3.46,40.09],"es":[-3.46,40.09],"esp":[-3.46,40.09],"ireland":[-7.8,53.08],"irlanda":[-7.8,53.08],"ie":[-7.8,53.08],"irl":[-7.8,53.08],"newcaledonia":[165.08,-21.06],"nuevacaledonia":[165.08,-21.06],"nc":[165.08,-21.06],"ncl":[165.08,-21.06],"solomonislands":[159.17,-8.03],"islassalomon":[159.17,-8.03],"solomonis":[159.17,-8.03],"sb":[159.17,-8.03],"slb":[159.17,-8.03],"newzealand":[172.79,-39.76],"nuevazelanda":[172.79,-39.76],"nz":[172.79,-39.76],"nzl":[172.79,-39.76],"australia":[134.05,-24.13],"au":[134.05,-24.13],"aus":[134.05,-24.13],"srilanka":[80.7,7.58],"lk":[80.7,7.58],"lka":[80.7,7.58],"peoplesrepublicofchina":[106.34,32.5],"china":[106.34,32.5],"cn":[106.34,32.5],"chn":[106.34,32.5],"taiwan":[120.87,23.65],"republicadechina":[120.87,23.65],"cntw":[120.87,23.65],"twn":[120.87,23.65],"tw":[120.87,23.65],"italy":[11.08,44.73],"italia":[11.08,44.73],"it":[11.08,44.73],"ita":[11.08,44.73],"denmark":[9.02,55.97],"dinamarca":[9.02,55.97],"dk":[9.02,55.97],"dnk":[9.02,55.97],"unitedkingdom":[-2.12,54.4],"reinounido":[-2.12,54.4],"gb":[-2.12,54.4],"gbr":[-2.12,54.4],"iceland":[-18.67,64.78],"islandia":[-18.67,64.78],"is":[-18.67,64.78],"isl":[-18.67,64.78],"azerbaijan":[47.21,40.4],"azerbaiyan":[47.21,40.4],"az":[47.21,40.4],"aze":[47.21,40.4],"georgia":[43.74,41.87],"ge":[43.74,41.87],"geo":[43.74,41.87],"philippines":[122.47,11.2],"filipinas":[122.47,11.2],"ph":[122.47,11.2],"phl":[122.47,11.2],"malaysia":[113.84,2.53],"malasia":[113.84,2.53],"my":[113.84,2.53],"mys":[113.84,2.53],"brunei":[114.55,4.45],"bruneidarussalam":[114.55,4.45],"bn":[114.55,4.45],"brn":[114.55,4.45],"slovenia":[14.92,46.06],"eslovenia":[14.92,46.06],"si":[14.92,46.06],"svn":[14.92,46.06],"finland":[27.28,63.25],"finlandia":[27.28,63.25],"fi":[27.28,63.25],"fin":[27.28,63.25],"slovakia":[19.05,48.73],"eslovaquia":[19.05,48.73],"sk":[19.05,48.73],"svk":[19.05,48.73],"czechrepublic":[15.38,49.88],"republicacheca":[15.38,49.88],"czechia":[15.38,49.88],"cz":[15.38,49.88],"cze":[15.38,49.88],"eritrea":[38.29,15.79],"er":[38.29,15.79],"eri":[38.29,15.79],"japan":[138.44,36.14],"japon":[138.44,36.14],"jp":[138.44,36.14],"jpn":[138.44,36.14],"paraguay":[-60.15,-21.67],"py":[-60.15,-21.67],"pry":[-60.15,-21.67],"yemen":[45.87,15.33],"ye":[45.87,15.33],"yem":[45.87,15.33],"saudiarabia":[44.7,23.81],"arabiasaudita":[44.7,23.81],"sa":[44.7,23.81],"sau":[44.7,23.81],"antarctica":[35.89,-79.84],"antartida":[35.89,-79.84],"aq":[35.89,-79.84],"ata":[35.89,-79.84],"turkishrepublicofnortherncyprus":[33.69,35.22],"republicaturcadelnortedechipre":[33.69,35.22],"ncyprus":[33.69,35.22],"northerncyprus":[33.69,35.22],"cyprus":[33.08,34.91],"chipre":[33.08,34.91],"cy":[33.08,34.91],"cyp":[33.08,34.91],"morocco":[-7.19,31.65],"marruecos":[-7.19,31.65],"ma":[-7.19,31.65],"mar":[-7.19,31.65],"egypt":[29.45,26.19],"egipto":[29.45,26.19],"eg":[29.45,26.19],"egy":[29.45,26.19],"libya":[18.01,26.64],"libia":[18.01,26.64],"ly":[18.01,26.64],"lby":[18.01,26.64],"ethiopia":[39.09,8.03],"etiopia":[39.09,8.03],"et":[39.09,8.03],"eth":[39.09,8.03],"djibouti":[42.5,11.98],"yibuti":[42.5,11.98],"dj":[42.5,11.98],"dji":[42.5,11.98],"somaliland":[46.73,9.44],"somalilandia":[46.73,9.44],"uganda":[32.95,1.97],"ug":[32.95,1.97],"uga":[32.95,1.97],"rwanda":[30.1,-1.9],"ruanda":[30.1,-1.9],"rw":[30.1,-1.9],"rwa":[30.1,-1.9],"bosniaandherzegovina":[18.07,44.09],"bosniayherzegovina":[18.07,44.09],"bosniaandherz":[18.07,44.09],"ba":[18.07,44.09],"bih":[18.07,44.09],"northmacedonia":[21.56,41.56],"macedoniadelnorte":[21.56,41.56],"mk":[21.56,41.56],"mkd":[21.56,41.56],"serbia":[20.79,44.19],"republicofserbia":[20.79,44.19],"rs":[20.79,44.19],"srb":[20.79,44.19],"montenegro":[19.14,42.8],"me":[19.14,42.8],"mne":[19.14,42.8],"kosovo":[20.86,42.59],"xk":[20.86,42.59],"trinidadandtobago":[-60.92,11.0],"trinidadytobago":[-60.92,11.0],"tt":[-60.92,11.0],"tto":[-60.92,11.0],"southsudan":[30.39,7.23],"sudandelsur":[30.39,7.23],"ssudan":[30.39,7.23],"ss":[30.39,7.23],"ssd":[30.39,7.23],"amazonas":[-69.94,-4.21],"antioquia":[-75.56,6.25],"arauca":[-70.76,7.08],"atlantico":[-74.8,10.96],"bolivar":[-75.51,10.39],"boyaca":[-73.36,5.54],"caldas":[-75.51,5.07],"caqueta":[-75.61,1.61],"casanare":[-72.4,5.34],"cauca":[-76.61,2.44],"cesar":[-73.25,10.46],"choco":[-76.66,5.69],"cordoba":[-75.88,8.75],"cundinamarca":[-74.07,4.71],"guainia":[-67.92,3.87],"guaviare":[-72.64,2.57],"huila":[-75.28,2.93],"laguajira":[-72.91,11.54],"guajira":[-72.91,11.54],"magdalena":[-74.2,11.24],"meta":[-73.63,4.14],"narino":[-77.28,1.21],"nortedesantander":[-72.5,7.89],"putumayo":[-76.65,0.83],"quindio":[-75.68,4.53],"risaralda":[-75.69,4.81],"sanandres":[-81.7,12.58],"santander":[-73.13,7.12],"sucre":[-75.4,9.3],"tolima":[-75.24,4.44],"valledelcauca":[-76.53,3.44],"valle":[-76.53,3.44],"vaupes":[-70.23,1.25],"vichada":[-67.92,6.19],"bogota":[-74.07,4.71],"bogotadc":[-74.07,4.71],"medellin":[-75.56,6.25],"cali":[-76.53,3.44],"barranquilla":[-74.8,10.96],"cartagena":[-75.51,10.39],"cucuta":[-72.5,7.89],"bucaramanga":[-73.13,7.12],"pereira":[-75.69,4.81],"santamarta":[-74.2,11.24],"ibague":[-75.24,4.44],"manizales":[-75.51,5.07],"villavicencio":[-73.63,4.14],"pasto":[-77.28,1.21],"monteria":[-75.88,8.75],"neiva":[-75.28,2.93],"popayan":[-76.61,2.44],"valledupar":[-73.25,10.46],"sincelejo":[-75.4,9.3],"tunja":[-73.36,5.54],"florencia":[-75.61,1.61],"riohacha":[-72.91,11.54],"quibdo":[-76.66,5.69],"yopal":[-72.4,5.34],"leticia":[-69.94,-4.21],"mocoa":[-76.65,0.83],"soledad":[-74.77,10.92],"bello":[-75.55,6.34],"envigado":[-75.58,6.17],"itagui":[-75.61,6.18],"rionegro":[-75.37,6.15],"soacha":[-74.22,4.58],"palmira":[-76.3,3.54],"buga":[-76.3,3.9],"tulua":[-76.2,4.09],"yumbo":[-76.5,3.58],"chia":[-74.06,4.86],"zipaquira":[-74.0,5.03],"girardot":[-74.8,4.3],"buenaventura":[-77.03,3.88],"apartado":[-76.63,7.88],"barrancabermeja":[-73.85,7.06],"duitama":[-73.03,5.83],"sogamoso":[-72.93,5.72],"fusagasuga":[-74.36,4.34],"facatativa":[-74.35,4.81],"madridco":[-74.26,4.73],"madrid":[-3.7,40.42],"barcelona":[2.17,41.39],"lima":[-77.04,-12.05],"quito":[-78.47,-0.18],"guayaquil":[-79.92,-2.19],"santiago":[-70.65,-33.44],"buenosaires":[-58.38,-34.6],"saopaulo":[-46.63,-23.55],"riodejaneiro":[-43.2,-22.91],"ciudaddemexico":[-99.13,19.43],"mexicocity":[-99.13,19.43],"guadalajara":[-103.35,20.66],"monterrey":[-100.32,25.69],"ciudaddepanama":[-79.52,8.98],"sanjose":[-84.09,9.93],"sansalvador":[-89.19,13.69],"tegucigalpa":[-87.19,14.07],"managua":[-86.25,12.11],"caracas":[-66.9,10.49],"montevideo":[-56.16,-34.9],"asuncion":[-57.58,-25.26],"lapaz":[-68.15,-16.5],"santodomingo":[-69.93,18.49],"sanjuan":[-66.11,18.47],"lahabana":[-82.38,23.13],"miami":[-80.19,25.76],"newyork":[-74.01,40.71],"nuevayork":[-74.01,40.71],"toronto":[-79.38,43.65],"london":[-0.13,51.51],"londres":[-0.13,51.51],"paris":[2.35,48.86],"lisboa":[-9.14,38.72],"roma":[12.5,41.9],"berlin":[13.4,52.52],"amsterdam":[4.9,52.37],"dublin":[-6.26,53.35],"frankfurt":[8.68,50.11],"zurich":[8.54,47.38],"milan":[9.19,45.46],"dubai":[55.27,25.2],"singapore":[103.82,1.35],"singapur":[103.82,1.35],"tokyo":[139.69,35.69],"sydney":[151.21,-33.87],"mumbai":[72.88,19.08],"bangalore":[77.59,12.97],"manila":[120.98,14.6],"hongkong":[114.17,22.32]};

/* ============================================================================
   3. DETECCION DE COLUMNAS  ·  ingles + espanol
   ========================================================================== */
const ROLES = [
  ['count',  ['equipos','dispositivos','devicecount','devicecounts','numerodispositivos',
              'numeroequipos','recuento','cantidadequipos','totalequipos','devices',
              'instalaciones','installs','conteo','cantidad']],
  ['device', ['devicename','device','equipo','nombreequipo','hostname','host','computer','computername',
              'computador','maquina','machine','pc','nombredispositivo','dispositivo','asset','activo','nombrepc']],
  ['user',   ['username','user','usuario','nombreusuario','samaccountname','upn','owner','propietario','empleado']],
  ['domain', ['domainname','domain','dominio','forest','tenant']],
  ['vendor', ['softwarevendor','vendor','fabricante','publisher','editor','proveedor','marca','manufacturer','empresa']],
  ['app',    ['softwarename','software','aplicacion','application','app','producto','product','productname',
              'nombreaplicacion','nombresoftware','programa','displayname','nombre']],
  ['ver',    ['softwareversion','version','versionsoftware','versionaplicacion','displayversion','versionapp','build']],
  ['cpe',    ['productcodecpe','cpe','productcode','codigoproducto','cpeid','cpename']],
  ['os',     ['osdistribution','os','sistemaoperativo','operatingsystem','so','plataforma','platform','osname']],
  ['osver',  ['osversioninfo','osversion','versionso','versionsistemaoperativo','osbuild','buildnumber','release','edicion']],
  ['ts',     ['timestamp','fecha','date','fechareporte','lastseen','ultimavez','ultimoreporte','fechahora',
              'collecteddate','scandate','fecharegistro','datetime','lastcontact','ultimaconexion']],
  ['geo',    ['country','pais','ciudad','city','region','sede','ubicacion','location','site','oficina','sucursal',
              'departamento','zona','paisregion','geografia','localidad','branch']],
  ['cliente',['cliente','client','organizacion','organization','empresa','company','tenant','customer',
              'razonsocial','compania','grupo']],
  ['area',   ['area','departamento','division','unidad','gerencia','vicepresidencia','equipo_area',
              'businessunit','unidadnegocio','centrocosto','costcenter','ou','departament']],
  ['eos',    ['endofsupportstatus','endofsupport','eos','findesoporte','estadosoporte',
              'soportefinalizado','supportstatus']],
  ['approved',['aprobada','versionaprobada','approvedversion','versionobjetivo','targetversion',
              'versionesperada']],
  ['salud',  ['sensorhealthstate','saludsensor','estadosensor','healthstate','sensorhealth']],
  ['eos',    ['endofsupportstatus','endofsupport','eos','findesoporte','estadosoporte',
              'soportefinalizado','supportstatus']],
  ['approved',['aprobada','versionaprobada','approvedversion','versionobjetivo','targetversion',
              'versionesperada']],
  ['salud',  ['sensorhealthstate','saludsensor','estadosensor','healthstate','sensorhealth']]
];

function detectColumns(headers) {
  const cols = {}, used = new Set();
  const H = headers.map((h, i) => ({ i, raw: h, n: norm(h) }));
  for (const [role, keys] of ROLES) {
    let hit = H.find(h => !used.has(h.i) && keys.includes(h.n));                 // exacto
    if (!hit) hit = H.find(h => !used.has(h.i) && keys.some(k => k.length > 3 && h.n.includes(k)));  // contiene
    if (hit) { cols[role] = hit.i; used.add(hit.i); }
  }
  return cols;
}
