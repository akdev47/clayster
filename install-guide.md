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

This installs all dependencies defined in package.json.

## Run the project

    npx vite

Vite will display the local URL where the application is running,
usually http://localhost:5173.

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

## Run Django

    python manage.py runserver (or python3 manage.py runserver)
