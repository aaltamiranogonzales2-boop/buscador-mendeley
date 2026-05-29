# Buscador académico + Cita automática Mendeley

Aplicación web que permite a cualquier usuario:
- Iniciar sesión con su cuenta Mendeley (OAuth 2.0)
- Buscar artículos en OpenAlex y guardarlos en su biblioteca
- Subir un .docx y obtener el documento con citas convertidas a campos Mendeley Cite

## Stack

- Node.js puro (sin dependencias npm)
- HTML/CSS/JS vanilla en el frontend
- Mendeley OAuth 2.0 Authorization Code flow
- Sesión cifrada en cookie HTTP-only (AES-256-GCM)

## Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `MENDELEY_CLIENT_ID` | Client ID de la app registrada en https://dev.mendeley.com/myapps/ |
| `MENDELEY_CLIENT_SECRET` | Client Secret de la misma |
| `SESSION_SECRET` | Cadena aleatoria larga (ej. 64 chars). Cifra las cookies de sesión. |
| `APP_URL` | URL pública con HTTPS, ej. `https://tu-app.onrender.com`. Debe coincidir con la registrada en Mendeley. |
| `PORT` | (opcional) Puerto. Render lo asigna automáticamente. |

## Deploy en Render

1. Sube este repo a GitHub.
2. Crea una cuenta en https://render.com (gratis).
3. New + → Web Service → conecta tu repo → selecciona la rama `main`.
4. Build Command: (deja vacío)
5. Start Command: `node server.js`
6. En "Environment" añade las 4 variables de arriba.
7. Deploy. Render te da una URL `https://tu-app.onrender.com`.
8. En Mendeley dev portal, actualiza el `Redirect URI` a `https://tu-app.onrender.com/auth/callback`.

## Desarrollo local

```bash
# Generar un session secret
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Configurar variables (PowerShell)
$env:MENDELEY_CLIENT_ID = "..."
$env:MENDELEY_CLIENT_SECRET = "..."
$env:SESSION_SECRET = "..."
$env:APP_URL = "http://localhost:8000"

# En Mendeley dev portal, el Redirect URI debe ser http://localhost:8000/auth/callback
node server.js
```

## Endpoints

- `GET /` → app HTML
- `GET /auth/login` → redirige a Mendeley OAuth
- `GET /auth/callback` → recibe el code, lo intercambia por tokens, guarda en cookie
- `GET /auth/logout` → limpia la cookie
- `GET /api/me` → estado de sesión (`{authenticated, name?, email?}`)
- `* /api/mendeley/*` → proxy autenticado a `api.mendeley.com/*`

## Seguridad

- Tokens nunca se exponen al navegador.
- Cookie cifrada con AES-256-GCM y firmada con tag de autenticación.
- Cookie marcada HTTP-only + SameSite=Lax + Secure (en HTTPS).
- Refresh automático del access_token cuando está por expirar.
