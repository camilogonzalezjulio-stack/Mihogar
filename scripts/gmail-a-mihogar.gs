/**
 * MiHogar: lee en Gmail las facturas de Air-e, Gases del Caribe, Triple A y Claro y registra el valor a pagar
 * en la app (Servicios → Luz, Gas, Agua, Internet).
 *
 * Instalación (una sola vez):
 *  1. Entra a https://script.google.com con la cuenta de Gmail donde llegan las facturas → Nuevo proyecto.
 *  2. Borra lo que trae y pega TODO este archivo. Guarda (Ctrl+S).
 *  3. En la barra elige la función `instalar` y dale ▶ Ejecutar. Acepta los permisos.
 *  No lleva claves: la app reconoce tu cuenta de Google (solo las cuentas permitidas en api/ingest-bill.js).
 *  Desde ahí revisa el correo cada 5 minutos. Para probar sin esperar, ejecuta `revisarCorreo`.
 *  Lo que no pueda leer queda con la etiqueta "MiHogar/revisar"; lo registrado, con "MiHogar/registrado".
 */
const CONFIG = {
  endpoint: 'https://mihogar-orcin.vercel.app/api/ingest-bill',
  dias: 45, // solo correos de los últimos N días
};

// Remitentes de cada empresa y tu número de cuenta con ella (NIC, póliza, contrato, ID).
// Con `cuenta`, solo se registran correos que traen ese número (descarta publicidad y facturas de otras casas)
// y también se encuentran facturas reenviadas desde otro correo. Escribe aquí tus números, no en el repositorio.
const EMPRESAS = [
  { id: 'aire', from: ['air-e.com'], cuenta: '' },                          // Luz: NIC
  { id: 'gases', from: ['gascaribe.com', 'gasesdelcaribe.com'], cuenta: '' }, // Gas: contrato
  { id: 'triplea', from: ['aaa.com.co', 'triplea.com.co'], cuenta: '' },      // Agua: póliza
  { id: 'claro', from: ['claro.com.co'], cuenta: '' },                       // Internet: ID
];

const ETIQUETA_OK = 'MiHogar/registrado';
const ETIQUETA_REVISAR = 'MiHogar/revisar';
const ETIQUETA_IGNORADO = 'MiHogar/ignorado';

const soloDigitos = s => String(s || '').replace(/\D/g, '');
/** ¿El texto trae el número de cuenta? Acepta espacios, puntos o guiones en medio ("6676845-5"). */
function traeCuenta(texto, cuenta) {
  return texto.replace(/[\s.\-]/g, '').includes(soloDigitos(cuenta));
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  // Cada 5 minutos: casi inmediato y dentro del límite diario gratis de Apps Script (~90 min de ejecución).
  ScriptApp.newTrigger('revisarCorreo').timeBased().everyMinutes(5).create();
  revisarCorreo();
}

function revisarCorreo() {
  // Pedir el correo hace que Google incluya ese dato en el token, y así la app reconoce la cuenta.
  console.log('Cuenta: ' + Session.getEffectiveUser().getEmail());
  const ok = GmailApp.getUserLabelByName(ETIQUETA_OK) || GmailApp.createLabel(ETIQUETA_OK);
  const revisar = GmailApp.getUserLabelByName(ETIQUETA_REVISAR) || GmailApp.createLabel(ETIQUETA_REVISAR);
  const ignorado = GmailApp.getUserLabelByName(ETIQUETA_IGNORADO) || GmailApp.createLabel(ETIQUETA_IGNORADO);

  EMPRESAS.forEach(empresa => {
    const origen = `from:(${empresa.from.join(' OR ')})` + (empresa.cuenta ? ` OR "${soloDigitos(empresa.cuenta)}"` : '');
    const q = `(${origen}) newer_than:${CONFIG.dias}d -label:${ETIQUETA_OK} -label:${ETIQUETA_REVISAR} -label:${ETIQUETA_IGNORADO}`;
    GmailApp.search(q, 0, 20).forEach(hilo => {
      const msg = hilo.getMessages().pop(); // el más reciente del hilo
      const texto = msg.getSubject() + '\n' + msg.getPlainBody();
      if (empresa.cuenta && !traeCuenta(texto, empresa.cuenta)) { hilo.addLabel(ignorado); return; }
      const valor = leerValor(texto);
      if (!valor) { hilo.addLabel(revisar); return; }

      const fecha = msg.getDate();
      const res = UrlFetchApp.fetch(CONFIG.endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
        payload: JSON.stringify({
          provider: empresa.id,
          amount: valor,
          month: Utilities.formatDate(fecha, 'America/Bogota', 'yyyy-MM'),
          due: leerVencimiento(texto) || undefined,
          messageId: msg.getId(),
        }),
      });
      console.log(empresa.id, valor, res.getResponseCode(), res.getContentText());
      if (res.getResponseCode() === 200) hilo.addLabel(ok);
      else if (res.getResponseCode() === 422) hilo.addLabel(revisar); // no hay servicio que corresponda en la app
      // otros errores: se reintenta en la próxima revisión
    });
  });
}

/** "$ 85.430" / "85.430,00" / "$85,430" → 85430. Devuelve 0 si no encuentra un valor a pagar. */
function leerValor(texto) {
  const patrones = [
    /(?:total\s+a\s+pagar|valor\s+a\s+pagar|total\s+factura|valor\s+total|monto\s+a\s+pagar|saldo\s+a\s+pagar|pago\s+total)[^\d$]{0,40}\$?\s*([\d][\d.,]*)/i,
    /\$\s*([\d]{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?)/,
  ];
  for (const re of patrones) {
    const m = texto.match(re);
    if (m) { const n = aNumero(m[1]); if (n >= 1000) return n; }
  }
  return 0;
}

function aNumero(s) {
  s = String(s).trim().replace(/[.,]$/, '');
  // ",dd" o ".dd" al final son centavos (85.430,00 · 85430,50); ".ddd" son miles (85.430).
  const cent = s.match(/^(.*\d)[.,]\d{2}$/);
  if (cent && (/[.,]/.test(cent[1]) || cent[1].length > 3)) s = cent[1];
  return Number(s.replace(/[.,]/g, '')) || 0;
}

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

/** Fecha límite de pago → "YYYY-MM-DD", o '' si no la encuentra. */
function leerVencimiento(texto) {
  const pre = /(?:fecha\s+(?:l[ií]mite|de\s+vencimiento|oportuna)(?:\s+de\s+pago)?|vence|vencimiento|p[aá]guese\s+hasta|pague\s+hasta|pagar\s+antes\s+de)[^\d]{0,25}/i.source;
  let m = texto.match(new RegExp(pre + '(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{2,4})', 'i'));
  if (m) return armarFecha(m[3], m[2], m[1]);
  m = texto.match(new RegExp(pre + '(\\d{4})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{1,2})', 'i'));
  if (m) return armarFecha(m[1], m[2], m[3]);
  m = texto.match(new RegExp(pre + '(\\d{1,2})\\s+de\\s+([a-záéíóú]+)(?:\\s+de(?:l)?)?\\s+(\\d{4})', 'i'));
  if (m && MESES[m[2].toLowerCase()]) return armarFecha(m[3], MESES[m[2].toLowerCase()], m[1]);
  return '';
}

function armarFecha(y, mo, d) {
  y = Number(y); if (y < 100) y += 2000;
  mo = Number(mo); d = Number(d);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
