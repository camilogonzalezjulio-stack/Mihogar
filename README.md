# MiHogar

Gastos de la casa, compras/inventario y finanzas personales. Vite + Firebase (plan Spark gratuito).

## Desarrollo

```bash
npm install
npm run dev
```

Abre http://localhost:5173. Si `.env` no tiene `VITE_FIREBASE_API_KEY`, la app no pide sesión y guarda solo en el navegador.

## Configuración (.env)

Copia `.env.example` a `.env` y llena los valores de tu app web de Firebase
(Consola > Configuración del proyecto > Tus apps > Web `</>` > Configuración del SDK).
`.env` está en `.gitignore`, así que no se sube al repositorio.

> Las variables `VITE_*` se incluyen en el JS publicado: la config de Firebase **no es secreta** por diseño.
> Lo que protege los datos es el inicio de sesión y las reglas de `firestore.rules`.

## Firebase

Proyecto **`mihogar-6e6c6`** (plan Spark): Firestore en `nam5`, Auth con correo/contraseña
(registro y borrado de cuentas desde la app desactivados) y las reglas de `firestore.rules` publicadas.
Si cambias `firestore.rules`, pégalas en Firestore → Reglas → Publicar, o usa `npm run deploy:rules`.

**Usuarios:** Authentication > Usuarios > Agregar usuario, uno por persona:
   | Usuario en la app | Correo en Firebase    |
   |-------------------|-----------------------|
   | camilo            | `camilo@mihogar.test` |
   | sofia             | `sofia@mihogar.test`  |
   Para agregar más personas, créalas igual y añade su correo en `firestore.rules`.

## Publicar (Vercel)

La app está en **https://mihogar-orcin.vercel.app** (equipo `mojon` de Vercel), conectada al repositorio
`camilogonzalezjulio-stack/Mihogar`: cada push a `main` publica solo.

```bash
npm run deploy
```

(equivale a `git push`). Vercel no necesita variables de entorno: la configuración web de Firebase va como
valor por defecto en `firebase-config.js` (no es secreta). Un `.env` con `VITE_FIREBASE_*` la reemplaza si
algún día quieres apuntar a otro proyecto.

Para publicar reglas desde la terminal (opcional): `npm install -g firebase-tools`, `firebase login`,
`firebase use mihogar-6e6c6`, `npm run deploy:rules`.

## Recordatorios de servicios sin pagar (Telegram y Discord)

Todos los días a las **9:00 am, 4:00 pm y 9:00 pm (hora Colombia)** se revisa y, si hay algo pendiente, se envía:

- **Del 25 a fin de mes:** los servicios del mes que no están marcados como pagados (y los que no tienen recibo registrado).
- **Del 1 al 3:** los recibos del mes anterior sin pagar ("Vence el 3").
- **Desde el 4:** cada recibo de un mes anterior sin pagar aparece **en mora** con sus días (el 4 = 1 día de mora),
  todos los días hasta que se marque como pagado.

Si no hay nada pendiente, no se envía nada.

Lo corre **Vercel Cron** (gratis en el plan Hobby), porque las funciones programadas de Firebase exigen el plan de pago Blaze.
Función: `api/notify-unpaid.js` (usa `scripts/notify-unpaid.mjs`) · horarios: `crons` en `vercel.json` (en UTC).

### Configuración
Todas las variables van en **Vercel → mihogar → Settings → Environment Variables** (se puede pegar el `.env` completo):

| Variable | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token del bot (@BotFather → `/newbot`) |
| `TELEGRAM_CHAT_ID` | id del grupo (con el bot dentro; en grupos empieza con `-`) |
| `DISCORD_WEBHOOK_URL` | canal → Editar canal → Integraciones → Webhooks → Copiar URL |
| `FIREBASE_SERVICE_ACCOUNT` | contenido completo del JSON de Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada. **Es secreto.** |
| `CRON_SECRET` | texto al azar; Vercel lo envía en cada ejecución y la función rechaza cualquier llamada sin él |
| `APP_URL` | opcional, enlace a la app al final del mensaje |

Después de agregar o cambiar variables hay que volver a publicar (Deployments → ⋯ → Redeploy, o un `git push`).

Notas:
- En el plan Hobby, Vercel ejecuta cada cron en algún momento dentro de esa hora (el de las 9:00 puede llegar 9:00–9:59).
- Para no avisar de servicios sin recibo registrado, agrega la variable `NOTIFY_INCLUDE_UNREGISTERED=0`.

Prueba local (sin enviar nada): `NOTIFY_FORCE=1 NOTIFY_DRY_RUN=1 NOTIFY_DATA_FILE=respaldo.json npm run notify`,
usando un archivo descargado con el botón "Respaldo" de la app.

## Facturas automáticas desde Gmail

`scripts/gmail-a-mihogar.gs` es un Google Apps Script que corre gratis en tu cuenta de Gmail cada 5 minutos: busca
correos de **Air-e, Gases del Caribe, Triple A y Claro**, lee el valor a pagar (y la fecha límite si aparece) y lo
envía a `api/ingest-bill.js`, que lo registra como **pendiente** en Luz, Gas, Agua o Internet del **mes facturado**:
el anterior a la fecha límite (o, si no la trae, el anterior a la llegada del correo). Así la factura de octubre que
llega en noviembre queda en octubre, vence el 3 de noviembre y desde el 4 entra en mora.
Si ese recibo ya está marcado como pagado no lo toca; si ya existe y está pendiente, actualiza el valor.
Solo se registran correos que traen el **número de cuenta** de `EMPRESAS` (los demás quedan en "MiHogar/ignorado").

Instalación:
1. https://script.google.com (con la cuenta donde llegan las facturas) → **Nuevo proyecto**.
2. Pega todo `scripts/gmail-a-mihogar.gs` (no lleva claves: la app reconoce tu cuenta de Google).
3. Guarda, elige la función **`instalar`** → ▶ Ejecutar → acepta los permisos de Gmail.

En Gmail quedan etiquetas: **MiHogar/registrado** (leído y guardado) y **MiHogar/revisar** (no se encontró el
valor o no hay servicio que corresponda). Si una empresa escribe desde otro correo, agrégalo en `EMPRESAS`.
Requiere `FIREBASE_SERVICE_ACCOUNT` en Vercel.

### Reenviar los recibos a ese Gmail

El script busca por **remitente** (Air-e, Gases del Caribe, Triple A, Claro), así que el reenvío debe ser
**automático** (conserva el remitente original). Un reenvío manual cambia el remitente y no se detecta.

**Si hoy llegan a otro Gmail:** en ese Gmail → ⚙️ → Ver todos los ajustes → *Reenvío y correo POP/IMAP* →
*Añadir una dirección de reenvío* → escribe el Gmail del script → confirma con el código que llega allá.
Luego, en la búsqueda de Gmail escribe
`from:(air-e.com OR gascaribe.com OR gasesdelcaribe.com OR aaa.com.co OR claro.com.co)` → ícono de filtros →
*Crear filtro* → marca *Reenviar a* (el Gmail del script) y *Aplicar también a las conversaciones que coincidan*.

**Si llegan a Outlook/Hotmail:** ⚙️ → Correo → *Reglas* → *Agregar nueva regla* → condición *De* con esas
direcciones → acción **Redirigir a** (no "Reenviar") el Gmail del script.

**Mejor aún:** inscribe directamente ese Gmail como correo de factura electrónica en cada empresa
(en su página, oficina virtual o línea de atención). La administración no hace falta: es un valor fijo.

## Valores fijos mensuales

Un servicio puede tener **valor fijo mensual** (✎ en el servicio). Cada mes la app crea sola el recibo
pendiente con ese valor, y los recordatorios lo incluyen. **Administración** viene con $454.000.

## Comprobante de pago

Un recibo solo se puede marcar como **pagado** subiendo el **comprobante de pago** (foto o PDF): al marcar la
casilla se pide el archivo, y en el formulario de editar "Ya está pagado" no se guarda sin él. El comprobante se
ve con 🧾 en el recibo. Se guarda en Firestore como `homes/main/receipts/pago-<id del recibo>`.

## Aviso al llegar una factura

Cuando el script de Gmail registra una factura nueva (o cambia su valor), `api/ingest-bill.js` manda de inmediato
un mensaje a Telegram y Discord con el servicio, el mes, el valor y la fecha límite.

## Escanear factura (OCR)

En **Finanzas → 📷 Escanear factura** se toma o elige la foto de un tiquete. `ocr.js` la lee con **Tesseract.js**
dentro del navegador (la foto no se envía a ningún servicio; la primera vez descarga el lector en español, ~2 MB),
detecta tienda, fecha, productos con precio y total, y abre una pantalla **editable** para corregir, agregar o quitar
productos antes de guardar. Se guarda como **un egreso** de la persona con el detalle de productos (🧾 para verlo
o editarlo). La lectura no es perfecta en tiquetes borrosos o arrugados: por eso siempre se revisa antes de guardar.
