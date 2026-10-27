# Clayster

Clayster lets customers design a custom clay stamp in the browser and order it.
They add text, SVG or PNG artwork, see the stamp in 2D and 3D (and pressed into
clay), and order it. The finished 3D-printable STL file is built in the browser
and stored with the order for production.

Made for the University of Twente design project 2026.

## What is in it

| Part | Where | What it does |
|---|---|---|
| Stamp generator | `src/stamp_generator/` | The design tool. Plain ES modules in the browser (no bundler): text and image conversion, checks, the 3D stamp, the order pages. |
| Orders | `src/orders/` | Receives an order (`POST /api/orders/`), checks it, prices it on the server, stores it with its STL. Customer order page at `/order/<guid>/`. |
| Shop back office | `src/dashboard/`, `src/products/`, `src/production/` | Staff pages for orders, products and the print queue. |
| Settings and URLs | `src/config/` | Django settings, driven by `DJANGO_*` environment variables. |
| Tests | `tests/` (JavaScript), `src/*/tests.py` (Django) | See below. |

Main technologies: Django 6.1, three.js, Manifold (3D solids, WebAssembly),
opentype.js, Bootstrap.

## Run it

You need Node.js 22+, npm and Python 3.12+.

    npm install                      # also copies the browser libraries to src/static/vendor/
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    cd src
    python manage.py migrate
    python manage.py runserver

The design tool is at http://localhost:8000/ and the back office at
`/dashboard/`. Create a staff user with `python manage.py createsuperuser`.

More detail: [install-guide.md](install-guide.md) (Linux and devenv) and
[docker.md](docker.md) (running the site in Docker).

## How the tool works

    text + font ---+
    SVG upload ----+--> 2D outline (mm) --> checks and repair --> 3D stamp --> preview / STL
    PNG upload ----+

- The design is a list of elements (text, SVG, PNG), each with a position,
  scale, stretch, rotation and mirroring (`designModel.js`).
- Everything becomes one 2D outline in millimetres. The 2D view, the printability
  checks and the 3D mesh all use that same outline and plate layout, so they
  always agree.
- The stamp is mirrored by default so the impression reads the right way round.
- The 3D stamp is only built when needed (3D view, review, order), to keep 2D
  editing fast.
- Only the stamp is exported; the clay is preview only.

## Settings you can change

Stamp sizes, margins, plate rounding, handle size, warning limits, text and
element limits and the maximum quantity are in one file:
`src/stamp_generator/static/stamp_generator/js/settings.js`. Each value has an
English and a Dutch comment. A nonsensical value stops the page with a message
naming it. Three values must match the server (`src/orders/pricing.py`); a test
checks this.

## Tests

    node --test tests/*.test.mjs     # JavaScript
    cd src && python manage.py test  # Django

The page code in `main.js` is not loaded by any test; one test only checks that
it imports everything it uses. Check UI changes in a browser.

## Good to know

- **Export STL** on the design page only shows when `DJANGO_DEBUG=true` or a
  staff user is logged in. Staff download each order's STL from the order page.
- **Payment and email are placeholders**: paying always succeeds and the
  confirmation email is printed in the server log. Connect the real ones in
  `src/orders/payments.py` and `src/orders/emails.py`.
- **Open issues and ideas** are listed in [ISSUES.md](ISSUES.md). Keep it up to
  date when you fix or find something.
- Generated and not committed: `src/static/vendor/` (run `npm run vendor`),
  `db.sqlite3`, `media/`.
