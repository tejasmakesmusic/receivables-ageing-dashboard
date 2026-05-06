# Local Setup

This repo is now a single Next.js application at the repository root.

## First Run

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

Open `http://localhost:3000/auth/google/login`.

For local development use:

```env
AUTH_PROVIDER=development
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
```

## Useful Checks

```bash
npm run typecheck
npm run lint
npm run build
```

Smoke-test locally:

```bash
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/dashboard?entity=IND&as_of=latest"
curl "http://localhost:3000/api/dashboard?entity=ALL&as_of=latest"
```

## Database

The hosted path uses Neon Postgres through Prisma. `DATABASE_URL` should be the
pooled runtime URL. `DATABASE_URL_DIRECT` is reserved for explicit Prisma
maintenance.

For a fully local database, run Postgres in Docker on `5433` and use the local
Prisma adapter:

```powershell
docker run -d --name receivables-postgres -e POSTGRES_USER=receivables -e POSTGRES_PASSWORD=receivables -e POSTGRES_DB=receivables -p 5433:5432 -v receivables-postgres-data:/var/lib/postgresql/data postgres:16-alpine
```

Use ignored `.env.local` values:

```env
DATABASE_ADAPTER=pg
DATABASE_URL=postgresql://receivables:receivables@127.0.0.1:5433/receivables?schema=public
DATABASE_URL_DIRECT=postgresql://receivables:receivables@127.0.0.1:5433/receivables?schema=public
```

Then sync and seed:

```powershell
npx prisma db push --accept-data-loss
Get-Content prisma/local-seed.sql | docker exec -i receivables-postgres psql -U receivables -d receivables -v ON_ERROR_STOP=1
```
