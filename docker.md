# Docker

One image runs the whole site: Django under gunicorn, with WhiteNoise serving
the static files (all JavaScript included). The stamp generator is at `/`,
and Django is at `/admin/`, `/dashboard/`, `/products/`, `/orders/` and
`/production/`. The database (SQLite) and uploaded stamp files live in a
Docker volume called `clayster-data`.

You need Docker with the Compose plugin. Nothing else.

## First run

    cp .env.example .env

Open `.env` and fill in `DJANGO_SECRET_KEY`. The file shows how to make one.
Then:

    docker compose up --build

The site is at http://localhost:8000. The database migrates itself on start.
Create your admin user once:

    docker compose exec web python manage.py createsuperuser

## Everyday commands

| What | Command |
|---|---|
| Start (rebuilds if code changed) | `docker compose up --build -d` |
| Stop, keep the data | `docker compose down` |
| Follow the log, with error stack traces | `docker compose logs -f web` |
| Django shell | `docker compose exec web python manage.py shell` |
| Stop and **delete the database and uploads** | `docker compose down -v` |

The normal image has your code baked in, so code changes need
`docker compose up --build -d`. For a faster loop, use development mode.

## Development mode

   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

This turns on Django's debug page (the stack trace in the browser) and mounts
`./src` into the container, so code and template changes show up in about a
second without a rebuild. It needs `src/static/vendor/`, which `npm install`
creates on your machine (or run `npm run vendor`).

In the normal image `DJANGO_DEBUG` is `false`, so a crashing page shows only
"Server Error", but the stack trace is in `docker compose logs web`. Never run
with `DJANGO_DEBUG=true` on a public server.

## Database migrations

**Applying.** Migrations run automatically every time the container starts.
After pulling someone else's migrations, run `docker compose up --build -d`
(normal mode) or `docker compose restart web` (development mode). To check
or run them by hand:

    docker compose exec web python manage.py showmigrations
    docker compose exec web python manage.py migrate

**Creating.** After you change a model, create the migration while the
**development mode** is running, because then the new file is written into
your own `src/` folder:

    docker compose exec web python manage.py makemigrations orders

Commit the new file in `src/<app>/migrations/`, and never edit or delete a
migration that has already been merged. In the normal image the file would be
created inside the container and lost.

**Two migrations with the same number** (two people changed the same app):
Django reports "conflicting migrations". Pull the latest main first, then
fix it with `docker compose exec web python manage.py makemigrations --merge`
and commit the result.

**Bringing your existing local data into Docker.** The Docker database is
separate from the `db.sqlite3` you used before. To copy yours in (this
replaces the Docker database):

    docker compose cp db.sqlite3 web:/data/db.sqlite3
    docker compose exec --user root web chown app /data/db.sqlite3
    docker compose restart web

The restart applies any migrations your old database was missing. Existing
orders get their own order-page link automatically.

**Backups.**

    docker compose cp web:/data/db.sqlite3 ./backup.sqlite3
    docker compose cp web:/data/media ./media-backup

The `media` folder holds the customers' STL files and only exists after the
first order with a stamp has been placed.

## Problems

- **"Set DJANGO_SECRET_KEY in .env"**: you have not created `.env` (see First run).
- **"port is already allocated"**: set `WEB_PORT=8001` (or another free port) in `.env`.
- **403 or "DisallowedHost" on a real domain**: put the domain in
  `DJANGO_ALLOWED_HOSTS` and the full address (`https://...`) in
  `DJANGO_CSRF_TRUSTED_ORIGINS`.
- **The stamp generator is blank in development mode**: `src/static/vendor/`
  is missing, so run `npm install`.
- **Your change does not show up**: you are in normal mode, so rebuild with
  `docker compose up --build -d`.

All settings are environment variables, listed with comments in `.env.example`.
