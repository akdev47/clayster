# Installation guide (Linux)

## Requirements

- Node.js 22 or newer
- npm
- Python 3.12 or newer

Check whether Node.js, npm and Python are installed:

    node --version
    npm --version
    python3 --version

This project requires Node.js 22 or newer (npm only fetches the browser
libraries and runs the tests) and Python 3.12 or newer (Django 6.1).

If Node.js is not installed, we recommend using NVM:

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    source ~/.bashrc
    nvm install 22
    nvm use 22

npm is included with Node.js when installed through NVM.

## Install project dependencies

From the project directory, run:

    npm install

This installs all dependencies defined in package.json:

- `three` — rendering, the STL/SVG loaders and the STL exporter
- `opentype.js` — turns a font into glyph outlines for the text input
- `polyclip-ts` — repairs artwork: self-intersections, overlapping
  outlines and inconsistent winding
- `three-bvh-csg` — the boolean operations that cut the relief into the
  stamp and press the stamp into the clay
- `three-mesh-bvh` — required by three-bvh-csg
- `manifold-3d` — closed-solid operations for the printable stamp; three-bvh-csg remains in use for the clay preview
- `bootstrap` — its JavaScript is loaded by the Django pages

The 3MF exporter is part of this project; it uses the `fflate` zip
library that already ships inside three's addons.

There is no bundler. `npm install` also runs `npm run vendor`, which copies
the browser files of these packages (and what they import) into
`src/static/vendor/`, so Django serves all JavaScript as plain static files.
That folder is generated and not committed; run `npm run vendor` again after
changing a dependency. The page lists the packages in an import map built from
`src/stamp_generator/importmap.json`; add a package there before importing
it from the stamp generator's code.

Fonts live in `src/stamp_generator/static/stamp_generator/fonts/`: Noto Sans
and Noto Serif, subset to Latin so four faces cost under 200 KB. They are
licensed under the SIL Open Font License; see `OFL.txt` in the same folder.
Any other `.ttf` or `.otf` can be uploaded in the app.

## Run the project

Create a Python environment once and install the Django dependencies:

    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt

Then start Django from the `src` folder:

    cd src
    python manage.py migrate
    python manage.py runserver

The stamp generator is at http://localhost:8000/ and the shop pages are at
`/dashboard/`, `/products/`, `/orders/` and `/production/`.

## How the app works

Artwork comes in as either text (with a font and layout) or an uploaded
SVG. Both are converted to the same canonical 2D outline in millimetres,
checked and repaired, then given stamp parameters and turned into a
mesh:

    text + font + layout --+
                           +--> canonical 2D --> validate/repair -->
    SVG upload ------------+        stamp params --> mesh --> preview --> export

The preview shows two things: the stamp itself, and a slab of clay with
the stamp pressed into it. Artwork is mirrored by default so the
impression reads the right way round — the stamp itself looks backwards,
which is correct.

Only the stamp is exported, as STL or 3MF. The clay is preview only.

The finished stamp is checked for open edges, inconsistent faces, collapsed or
duplicate triangles, disconnected outward shells, and non-positive volume.
STL bytes are loaded back and checked again before download. These are surface
checks, not a guarantee of printer compatibility or minimum feature thickness.

Run the JavaScript checks and the Django tests with:

    node --test tests/*.mjs
    cd src && python manage.py test

`tests/importMap.test.mjs` and `tests/browserModules.test.mjs` check that every
import in the stamp generator resolves the way the browser resolves it.

## Settings you can tweak

The numbers you may want to change (stamp size and thickness, the distance
from the text to the stamp edge, the rounding of the plate edges and corners, the handle size, when the page warns about
details that are too thin, text and element limits, PNG limits, the maximum
quantity) live in one file:
`src/stamp_generator/static/stamp_generator/js/settings.js`. Every value has an
English and a Dutch comment that says what it does and what happens when you
raise or lower it. Change a number, reload the page, done. A value that makes
no sense (for example a minimum above its maximum) stops the page with a
message that names the setting. Three values are also checked by the server
(`src/orders/pricing.py`) and must stay equal to it: `order.maxQuantity` and
`MAX_QUANTITY`, `stamp.maxWidthMm` and `MAX_STAMP_WIDTH_MM`, `stamp.maxLengthMm`
and `MAX_STAMP_LENGTH_MM`. The last two are the largest stamp (200 x 200 mm): a
bigger one shows an error and cannot be exported or ordered.
`node --test tests/settings.test.mjs` fails if they drift apart.

## How ordering works

The order page sends the order to Django (`POST /api/orders/`): the details and
design as JSON plus the finished STL. The server validates everything, works
out the price itself and stores the order as "Awaiting payment". The customer
then continues to `/order/<guid>/pay/`, and after paying lands on their own
order page `/order/<guid>/`. That link is the only thing that gives access to
the page, and it is emailed to them. Staff see the same order in the dashboard
at `/orders/`, with the customer's STL as a download.

Payment and email are placeholders for now. Pressing "Pay" accepts the order
without charging anything, and the confirmation email is printed in the server
log instead of being sent. `src/orders/payments.py` and `src/orders/emails.py`
are the places to connect the real ones.

After pulling changes that touch the models, run `python manage.py migrate`
(Docker does this on start).

# [recommended] Installation guide (devenv)

## Requirements

- Nix
- devenv

Check whether devenv is installed:

    devenv version

If devenv is not installed, follow the installation instructions at:

    https://devenv.sh/getting-started/

## Run devenv

[recommended] Automatically enter the shell

    devenv allow

Manually enter the shell

    devenv shell

## Run Django

    cd src
    python manage.py runserver (or python3 manage.py runserver)

The stamp generator is at http://localhost:8000/.

# Docker deployment

Running the site in Docker, development mode with stack traces, database
migrations and backups are explained in [docker.md](docker.md).
