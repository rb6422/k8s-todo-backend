# Backend (Gateway + Auth + Tasks)

Este folder contiene solo los servicios backend para desplegar separados del frontend.

## Servicios

- `gateway` (puerto 3000)
- `auth` (puerto 3001)
- `tasks` (puerto 3002)

## Ejecutar local con Docker

```bash
docker compose up --build -d
```

Health check:

```bash
curl http://localhost:3000/health
```

## Variables para deploy (Render/Fly/etc)

### Auth
- `PORT=3001`
- `JWT_SECRET=...`
- `DATABASE_URL=postgresql://...`

### Tasks
- `PORT=3002`
- `DATABASE_URL=postgresql://...`

### Gateway
- `PORT=3000`
- `AUTH_SERVICE=https://<auth-service-url>`
- `TASKS_SERVICE=https://<tasks-service-url>`
- `ALLOWED_ORIGINS=https://<frontend-pages-domain>`

## Base de datos en Neon

Crea proyecto en Neon y usa su cadena `DATABASE_URL` en `auth` y `tasks`.
