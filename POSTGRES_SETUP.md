# Postgres Setup

The app is now configured for PostgreSQL in `prisma/schema.prisma`.

## 1. Create a Postgres database

Use a managed provider for production. Good simple options:

- Neon
- Supabase
- Railway
- Render Postgres

## 2. Set `DATABASE_URL`

Update your local `.env` with a real Postgres connection string.

Example:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/myaipa?schema=public"
```

If your provider requires SSL, use the connection string they give you as-is.

## 3. Generate the Prisma client

```powershell
npm run db:generate
```

## 4. Create the database schema

For a first-time Postgres setup, the simplest path is:

```powershell
npm run db:push
```

If you want Prisma migration files after the database is reachable, run:

```powershell
npm run db:migrate -- --name init_postgres
```

Use `db:push` for initial bootstrapping. Use `db:migrate` once you want tracked schema changes.

## 5. Seed the database

```powershell
npm run db:seed
```

## 6. Start the app

```powershell
npm run server
```

## Notes

- The old SQLite file at `prisma/dev.db` is no longer the target database.
- This change does not migrate existing SQLite data into Postgres automatically.
- If you need old SQLite data preserved, export it separately and import it into Postgres.
- Do not commit real database credentials to git.
