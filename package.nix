{
  lib,
  buildNpmPackage,
  bpmn-to-image,
  bpmn-auto-layout,
}:

buildNpmPackage {
  pname = "bpmn-js-mcp";
  version = "1.0.0";

  src = lib.cleanSource ./.;

  npmDepsHash = "sha256-IdwdNPa11toW8ChpHiMh2slDvWlBOzlKvwzNrbtBmAg=";

  # The lockfile has unmet optional peer ranges (eslint-plugin-vitest) that npm
  # would otherwise try to fetch from the registry inside the sandbox.
  npmFlags = [ "--legacy-peer-deps" ];
  makeCacheWritable = true;

  # Pruning re-packs the git dependencies, whose `prepare` scripts need dev tools
  # that prune has just removed.
  npmPruneFlags = [ "--ignore-scripts" ];

  # esbuild bundles src/ into dist/index.js (see esbuild.config.mjs)
  npmBuildScript = "build";

  # The git dependencies were installed without running their `prepare` build
  # (see npmPruneFlags), so drop in the build output from their own flakes.
  postInstall = ''
    modules=$out/lib/node_modules/bpmn-js-mcp/node_modules
    cp -r --no-preserve=mode ${bpmn-to-image}/lib/node_modules/bpmn-to-image/{dist,fonts} $modules/bpmn-to-image/
    cp -r --no-preserve=mode ${bpmn-auto-layout}/lib/node_modules/bpmn-auto-layout/dist $modules/bpmn-auto-layout/
  '';

  meta = {
    description = "MCP server for creating and manipulating BPMN diagrams using bpmn-js";
    license = lib.licenses.mit;
    mainProgram = "bpmn-js-mcp";
  };
}
