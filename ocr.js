// Lectura de facturas/tiquetes con OCR (Tesseract.js). Corre en el navegador: la foto no sale del dispositivo.
// El resultado siempre se revisa y corrige a mano antes de guardarse (ver reviewReceipt en app.js).

// Líneas que tienen un número pero no son productos.
const SKIP = /(sub\s*-?\s*total|iva|impuesto|imp\.?\s*cons|cambio|efectivo|tarjeta|cr[eé]dito|d[eé]bito|nit|factura|fecha|hora|caja|cajer|redondeo|propina|base\s+grav|gracias|tel[eé]fono|tel\.|direcci|resoluci|cufe|autoriza|vuelto|recibido|pago|saldo|puntos|ahorr|art[ií]culos|items|unidades|cliente|c\.?c\.?|regimen|r[eé]gimen)/i;
// "ARROZ DIANA 1KG ..... 4.500" → nombre + precio al final (con letras sueltas tipo "A" o "G" de impuestos).
const PRICE_AT_END = /^(.*?[A-Za-zÁÉÍÓÚÑáéíóúñ].*?)[\s.:$*_-]*\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{3,7})(?:[.,]\d{1,2})?\s*[A-Za-z*]{0,2}$/;

/** "4.500" / "4,500" / "4500,00" / "$ 12.990" → 4500 / 4500 / 4500 / 12990 */
export function toNumber(s) {
  s = String(s).trim().replace(/[^\d.,]/g, '').replace(/[.,]$/, '');
  const cent = s.match(/^(.*\d)[.,]\d{1,2}$/);
  if (cent && (/[.,]/.test(cent[1]) || cent[1].length > 3)) s = cent[1];
  return Number(s.replace(/[.,]/g, '')) || 0;
}

function isoDate(text) {
  const m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/) || [];
  let [, d, mo, y] = m.map(Number);
  if (y && y < 100) y += 2000;
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) {
    const m2 = text.match(/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
    if (!m2) return '';
    [, y, mo, d] = m2.map(Number);
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Texto del OCR → { store, date, items: [{ name, price }], total } (lo mejor que se pueda; luego se edita). */
export function parseReceipt(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const items = [];
  let total = 0;
  for (const l of lines) {
    const t = l.match(/total[^\d]{0,15}\$?\s*([\d][\d.,]{2,})/i);
    if (t && !/sub\s*-?\s*total/i.test(l)) { total = Math.max(total, toNumber(t[1])); continue; }
    if (SKIP.test(l)) continue;
    const m = l.match(PRICE_AT_END);
    if (!m) continue;
    const price = toNumber(m[2]);
    if (price < 50) continue;
    const name = m[1].replace(/^\d+\s*(x|un|und)?\s+/i, '').replace(/[^\wÁÉÍÓÚÑáéíóúñ%\/ .-]/g, '').replace(/\s+/g, ' ').trim();
    if (name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').length < 2) continue;
    items.push({ name, price });
  }
  const store = lines.find(l => /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(l) && !SKIP.test(l)) || '';
  const sum = items.reduce((t, i) => t + i.price, 0);
  return { store: store.slice(0, 40), date: isoDate(text), items, total: total || sum };
}

// Escala de grises, más contraste y tamaño suficiente: mejora mucho la lectura de tiquetes térmicos.
function prepare(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(2, 1800 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
        p[i] = p[i + 1] = p[i + 2] = v;
      }
      x.putImageData(d, 0, 0);
      res(c);
    };
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}

/** Lee la foto y devuelve el texto. onProgress(0..1). La primera vez descarga el idioma español (~2 MB). */
export async function readImage(file, onProgress = () => {}) {
  const [{ createWorker }, canvas] = await Promise.all([import('tesseract.js'), prepare(file)]);
  const worker = await createWorker('spa', 1, {
    logger: m => { if (m.status === 'recognizing text') onProgress(m.progress); },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
