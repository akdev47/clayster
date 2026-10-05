{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:

{
  packages = [ pkgs.git ];

  languages.javascript = {
    enable = true;
    npm = {
      enable = true;
      install.enable = true;
    };
  };

  treefmt = {
    enable = true;

    config.programs = {
      prettier.enable = true;
      nixfmt.enable = true;
      shfmt.enable = true;
      shellcheck.enable = true;
    };
  };

  processes = {
    vite.exec = "npx vite";
  };

  enterTest = ''
    node --test tests/*
  '';

  git-hooks.hooks = {
    treefmt.enable = false;
    detect-private-keys.enable = true;
    check-added-large-files.enable = true;
    check-case-conflicts.enable = true;
  };

}
