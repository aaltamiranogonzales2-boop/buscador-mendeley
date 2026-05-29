# Buscador académico + Cita automática Mendeley

Aplicación web que permite a cualquier usuario:
- Iniciar sesión con su cuenta Mendeley (OAuth 2.0)
- Buscar artículos en OpenAlex (DOI, PMID, ArXiv ID, ISBN o palabras clave)
- Guardarlos en su biblioteca (con carpeta opcional)
- Subir un `.docx` y obtener el documento con citas convertidas a campos Mendeley Cite

## Stack

- **Node.js** puro (sin dependencias npm) en serverless functions
- **HTML/CSS/JS** vanilla en el frontend
- **Mendeley OAuth 2.0** Authorization Code flow
- **Sesión cifrada** en cookie HTTP-only (AES-256-GCM)
- **Vercel** como hosting (serverless functions + static)

## Arquitectura

```
/
├── api/                   # Vercel serverless functions
│   ├── auth/
│   │   ├── login.js       # → /auth/login (redirect a Mendeley OAuth)
│   │   ├── callback.js    # → /auth/callback (intercambia code por tokens)
│   │   └── logout.js      # → /auth/logout (limpia cookie)
│   ├── me.js              # → /api/me (estado de sesión)
│   └── mendeley/
│       └── [...path].js   # → /api/mendeley/* (proxy autenticado a Mendeley)
├── lib/
│   ├── session.js         # Cifrado de cookie + parse cookies
│   └── oauth.js           # OAuth helpers + token refresh + fetchHttps
├── mendeley-citas.html    # Frontend completo
├── vercel.json            # Rewrites: / → mendeley-citas.html, /auth/* → /api/auth/*
└── package.json
```

## Variables de entorno requeridas (Vercel)

| Variable | Descripción |
|---|---|
| `MENDELEY_CLIENT_ID` | Client ID de https://dev.mendeley.com/myapps/ |
| `MENDELEY_CLIENT_SECRET` | Client Secret de la misma |
| `SESSION_SECRET` | Cadena aleatoria de 48+ bytes en hex (para cifrar cookies) |
| `APP_URL` | URL pública HTTPS, ej. `https://buscador-mendeley.vercel.app` |

Genera un `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Mendeley app config

En https://dev.mendeley.com/myapps/, registra una app con:
- **Redirect URL**: `https://<tu-url-vercel>/auth/callback`

## Deploy en Vercel

1. Sube el repo a GitHub.
2. https://vercel.com → Sign in con GitHub → **+ Add New Project**.
3. Import el repo. Framework: **Other**. Build: dejar en blanco.
4. Add Environment Variables (las 4 de arriba).
5. **Deploy**. Vercel asigna `https://<nombre>.vercel.app`.
6. Actualiza `APP_URL` con la URL definitiva y dale **Redeploy**.

## Desarrollo local

```bash
npm install -g vercel
vercel link               # vincula el directorio al proyecto Vercel
vercel env pull           # baja las env vars
vercel dev                # corre el proyecto local en http://localhost:3000
```

Para OAuth local, registra una segunda Mendeley app con Redirect URL `http://localhost:3000/auth/callback`.

## Seguridad

- Tokens nunca se exponen al navegador.
- Cookie cifrada con AES-256-GCM y firmada con tag de autenticación.
- Cookie HTTP-only + SameSite=Lax + Secure (en HTTPS).
- Refresh automático del access_token cuando está por expirar.
