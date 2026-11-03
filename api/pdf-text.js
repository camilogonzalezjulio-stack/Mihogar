// Extrae el texto de un PDF adjunto a un correo de factura (p. ej. Triple A manda el valor solo en el PDF).
// La llama el Apps Script de Gmail: POST JSON { pdf: '<base64>' } → { text }.
// No guarda nada: el texto se usa en el script para leer el valor, la fecha límite y el número de cuenta.
import { extractText, getDocumentProxy } from 'unpdf';
import { rejection } from '../lib/script-auth.mjs';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  const motivo = await rejection(req);
  if (motivo) return res.status(401).json({ error: 'No autorizado', motivo });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: 'JSON inválido' }); }
  if (!body.pdf) return res.status(400).json({ error: 'Falta pdf (base64)' });

  try {
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(body.pdf, 'base64')));
    const { text } = await extractText(pdf, { mergePages: true });
    res.status(200).json({ text: String(text || '').slice(0, 60000), pages: pdf.numPages });
  } catch (e) {
    res.status(422).json({ error: 'No se pudo leer el PDF: ' + e.message });
  }
}
