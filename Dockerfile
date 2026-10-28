# Stage 1: copy the npm packages the browser needs into src/static/vendor/.
# There is no bundler: Django serves all JavaScript as static files.
FROM node:22-slim AS vendor
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts/ scripts/
COPY src/stamp_generator/importmap.json src/stamp_generator/
COPY src/stamp_generator/static/stamp_generator/js/ src/stamp_generator/static/stamp_generator/js/
RUN npm run vendor

# Stage 2: Django under gunicorn. WhiteNoise serves the static files, which
# include all JavaScript, the fonts and the sample models.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_DEBUG=false \
    DJANGO_DB_PATH=/data/db.sqlite3 \
    DJANGO_MEDIA_ROOT=/data/media \
    PORT=8000

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src/ ./src/
COPY --from=vendor /build/src/static/vendor ./src/static/vendor

# settings.py needs a secret key even for collectstatic; this one is not kept.
WORKDIR /app/src
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput

# Stop the build if any test fails, so broken code never starts.
RUN DJANGO_SECRET_KEY=build-only python manage.py test

# /data holds the SQLite database and uploaded files; mount a volume here.
RUN useradd --system --create-home app \
    && mkdir /data \
    && chown app /data
USER app

EXPOSE 8000

# A static file is served by WhiteNoise before Django checks ALLOWED_HOSTS, so
# this works whatever host names the site is configured for.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/static/css/main.css' % os.environ['PORT'])"

CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi --bind 0.0.0.0:${PORT} --access-logfile -"]
