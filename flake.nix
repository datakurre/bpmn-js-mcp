{
  description = "MCP server for creating and manipulating BPMN 2.0 diagrams using bpmn-js";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    # package.json pulls these two from git, and npm cannot build git
    # dependencies inside the Nix sandbox. Their own flakes build them instead.
    # Keep the revisions in sync with the `resolved` entries in package-lock.json.
    bpmn-to-image = {
      url = "github:datakurre/bpmn-to-image/9b26c0ff384ef3bb37109e4e41eb4ee4e1d75ea1";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    bpmn-auto-layout = {
      url = "github:datakurre/bpmn-auto-layout/139cc5803679651417a1dcd06107b6af761c5ffb";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.bpmn-to-image.follows = "bpmn-to-image";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      bpmn-to-image,
      bpmn-auto-layout,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.callPackage ./package.nix {
          bpmn-to-image = bpmn-to-image.packages.${pkgs.stdenv.hostPlatform.system}.default;
          bpmn-auto-layout = bpmn-auto-layout.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.default}/bin/bpmn-js-mcp";
          meta.description = "Run the BPMN MCP server over stdio";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          inputsFrom = [ self.packages.${pkgs.stdenv.hostPlatform.system}.default ];
          packages = [ pkgs.nodejs ];
        };
      });

      checks = forAllSystems (pkgs: {
        build = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}
