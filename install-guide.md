# Installation guide (Linux)

## Requirements

- Node.js 22 or newer
- npm

Check whether Node.js and npm are installed:

    node --version
    npm --version

This project requires Node.js 22 or newer.

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
- `vite` — the dev server and build (dev dependency)

The 3MF exporter is part of this project; it uses the `fflate` zip
library that already ships inside three's addons.

Fonts live in `fonts/`: Noto Sans and Noto Serif, subset to Latin so
four faces cost under 200 KB. They are licensed under the SIL Open Font
License; see `fonts/OFL.txt`. Any other `.ttf` or `.otf` can be uploaded
in the app.

## Run the project

    npx vite

Vite will display the local URL where the application is running,
usually http://localhost:5173.

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

Run the export regression checks with:

    node --test tests/export.test.mjs

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

## Run the project

    devenv up

Vite will display the local URL where the application is running,
usually http://localhost:5173.
