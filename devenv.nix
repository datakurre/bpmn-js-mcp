let
  shell = { pkgs, ... }: {
    packages = [
      pkgs.nodejs
      pkgs.github-copilot-cli

      # Fonts for SVG-to-PNG rendering (resvg-js needs font files to
      # rasterize text labels in BPMN diagrams).
      pkgs.liberation_ttf       # Liberation Sans/Serif/Mono (Arial-compatible)
      pkgs.dejavu_fonts         # DejaVu Sans/Serif/Mono (fallback)
    ];
  };
in
{
  profiles.shell.module = {
    imports = [ shell ];
  };
}
