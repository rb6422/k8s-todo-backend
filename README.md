# Backend (Gateway + Auth + Tasks)

Este repositorio/folder contiene solo el backend para desplegar separado del frontend.

## Servicios

- `gateway` (puerto 3000)
- `auth` (puerto 3001)
- `tasks` (puerto 3002)

## 1) Preparar Neon

1. Crea un proyecto en Neon.
2. Copia la cadena de conexion (`DATABASE_URL`).
3. Ejecuta el schema SQL de este repo en el SQL Editor de Neon:

```sql
-- archivo: sql/neon-init.sql
```

> Nota: los servicios tambien hacen `CREATE TABLE IF NOT EXISTS` al iniciar,
> pero correr el SQL en Neon te deja el schema versionado y listo desde antes.

## 2) Ejecutar backend local usando Neon (sin Postgres en Docker)

1. Crea `.env` desde `.env.example` y completa valores.
2. Levanta con compose Neon:

```bash
docker compose -f docker-compose.neon.yml --env-file .env up --build -d
```

Health check:

```bash
curl http://localhost:3000/health
```

## 3) Ejecutar backend local con Postgres Docker (solo dev local)

Si no quieres Neon en desarrollo local, puedes usar:

```bash
docker compose up --build -d
```

## Variables para deploy (Render/Fly/etc)

### Auth
- `PORT=3001`
- `JWT_SECRET=...`
- `DATABASE_URL=postgresql://...` (Neon)

### Tasks
- `PORT=3002`
- `DATABASE_URL=postgresql://...` (Neon)

### Gateway
- `PORT=3000`
- `AUTH_SERVICE=https://<auth-service-url>`
- `TASKS_SERVICE=https://<tasks-service-url>`
- `ALLOWED_ORIGINS=https://<frontend-domain>`

## Deploy en Render

Este repo incluye `render.yaml`. Al crear servicios:

1. despliega `auth` y `tasks` con `DATABASE_URL` de Neon
2. configura `gateway` con `AUTH_SERVICE` y `TASKS_SERVICE` apuntando a URLs publicas
3. configura `ALLOWED_ORIGINS` con tu dominio frontend (Pages/Vercel)
