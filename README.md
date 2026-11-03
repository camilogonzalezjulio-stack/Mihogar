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

(equivale a `git push`). Vercel no recibe el `.env` (ver `.vercelignore`): las variables `VITE_*` se cargan
una vez en Vercel → mihogar → Settings → Environment Variables (se puede pegar el `.env` completo) y luego
se vuelve a publicar.

Para publicar reglas desde la terminal (opcional): `npm install -g firebase-tools`, `firebase login`,
`firebase use mihogar-6e6c6`, `npm run deploy:rules`.

## Recordatorios de servicios sin pagar (Telegram y Discord)

Todos los días a las **9:00 am, 4:00 pm y 9:00 pm (hora Colombia)** se revisa y, si hay algo pendiente, se envía:

- **Del 25 a fin de mes:** los servicios del mes que no están marcados como pagados (y los que no tienen recibo registrado).
- **Del 1 al 3:** los recibos del mes anterior sin pagar ("Vence el 3").
- **Desde el 4:** cada recibo de un mes anterior sin pagar aparece **en mora** con sus días (el 4 = 1 día de mora),
  todos los días hasta que se marque como pagado.

Si no hay nada pendiente, no se envía nada.

Lo corre **GitHub Actions** (gratis), porque las funciones programadas de Firebase exigen el plan de pago Blaze.
Script: `scripts/notify-unpaid.mjs` · horario: `.github/workflows/notify-unpaid.yml`.

### 1. Telegram
1. En Telegram habla con **@BotFather** → `/newbot` → copia el **token**.
2. Crea un grupo con la familia, agrega el bot y escribe cualquier mensaje en el grupo.
3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia `chat.id` (en grupos empieza con `-`).

### 2. Discord
Canal → ⚙️ Editar canal → **Integraciones → Webhooks → Nuevo webhook** → **Copiar URL**.

### 3. Cuenta de servicio de Firebase
Consola → ⚙️ Configuración del proyecto → **Cuentas de servicio → Generar nueva clave privada**.
Descarga un JSON. **Es secreto** (da acceso total a la base): no lo subas al repositorio ni lo compartas.

### 4. GitHub
1. Sube el proyecto a un repositorio de GitHub (puede ser privado).
2. Repositorio → Settings → **Secrets and variables → Actions → New repository secret**:
   | Secreto | Valor |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | el contenido completo del JSON del paso 3 |
   | `TELEGRAM_BOT_TOKEN` | token del bot |
   | `TELEGRAM_CHAT_ID` | id del chat o grupo |
   | `DISCORD_WEBHOOK_URL` | URL del webhook |
   Opcional, en la pestaña **Variables**: `APP_URL` con el enlace de la app.
3. Para probar: pestaña **Actions → Recordatorio de servicios sin pagar → Run workflow**, marcando "Enviar aunque no sea día 25".

Notas:
- GitHub puede retrasar las ejecuciones programadas unos minutos (a veces 15–30).
- En repositorios públicos, GitHub pausa los workflows programados tras 60 días sin actividad en el repo; entra y reactívalo si pasa.
- Si no quieres avisos de servicios sin recibo registrado, agrega la variable `NOTIFY_INCLUDE_UNREGISTERED=0` al paso `env` del workflow.

Prueba local (sin enviar nada): `NOTIFY_FORCE=1 NOTIFY_DRY_RUN=1 NOTIFY_DATA_FILE=respaldo.json npm run notify`,
usando un archivo descargado con el botón "Respaldo" de la app.
