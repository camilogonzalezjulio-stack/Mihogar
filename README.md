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
Función:  (usa ) · horarios:  en  (en UTC).

### Configuración
Todas las variables van en **Vercel → mihogar → Settings → Environment Variables** (se puede pegar el  completo):

| Variable | Valor |
|---|---|
|  | token del bot (@BotFather → ) |
|  | id del grupo (con el bot dentro; en grupos empieza con ) |
|  | canal → Editar canal → Integraciones → Webhooks → Copiar URL |
|  | contenido completo del JSON de Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada. **Es secreto.** |
|  | texto al azar; Vercel lo envía en cada ejecución y la función rechaza cualquier llamada sin él |
|  | opcional, enlace a la app al final del mensaje |

Después de agregar o cambiar variables hay que volver a publicar (Deployments → ⋯ → Redeploy, o un ).

Notas:
- En el plan Hobby, Vercel ejecuta cada cron en algún momento dentro de esa hora (el de las 9:00 puede llegar 9:00–9:59).
- Para no avisar de servicios sin recibo registrado, agrega la variable .

Prueba local (sin enviar nada): ,
usando un archivo descargado con el botón "Respaldo" de la app.
