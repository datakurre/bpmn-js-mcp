# ADR-003: elkjs instead of bpmn-auto-layout

## Status

Accepted

## Decision

`bpmn-auto-layout` produces decent left-to-right layouts for simple flows but struggles with parallel branches that reconverge, nested subprocesses, and boundary-event recovery paths. `elkjs` implements the Sugiyama layered algorithm (ELK Layered) which handles these complex topologies correctly — proper layer assignment, crossing minimisation via `LAYER_SWEEP`, and `NETWORK_SIMPLEX` node placement. The `elkLayout()` function in `src/elk-layout.ts` works directly with the bpmn-js modeler (no XML round-trip), builds an ELK graph from the element registry, runs ELK layout, applies positions back via `modeling.moveElements`, snaps same-layer elements to a common Y (vertical alignment), and applies ELK's own orthogonal edge routes as connection waypoints. `bpmn-auto-layout` is retained solely for DI generation in `import_bpmn_xml` when imported XML lacks `bpmndi:BPMNShape`/`bpmndi:BPMNEdge` elements.
