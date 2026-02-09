# ADR-014: Post-ELK grid snapping

## Status

Accepted

## Decision

`bpmn-auto-layout` produces visually appealing diagrams due to its grid-based placement model (150×140 px cells, uniform rhythm, inter-cell channel routing). Our ELK engine has superior crossing minimisation, happy-path preservation, collaboration support, and partial re-layout, but its output lacked the visual regularity of a grid. Rather than replacing ELK with a grid algorithm (losing structural advantages), a post-processing `gridSnapPass()` quantises ELK positions to a virtual grid. After ELK runs its Sugiyama layered algorithm, gridSnapPass: (1) detects layers by grouping elements with similar x-centres, (2) snaps each layer to a uniform x-column based on the previous layer's right edge + gap, (3) distributes elements vertically within each layer with equal spacing while pinning happy-path elements, and (4) re-centres gateways on their connected branches. ELK spacing constants (`ELK_LAYER_SPACING=100`, `ELK_NODE_SPACING=80`, `ELK_EDGE_NODE_SPACING=25`) were tuned to match bpmn-auto-layout's visual density. The grid snap is enabled by default but can be disabled via `gridSnap: false` in `ElkLayoutOptions`. BRANDES_KOEPF node placement was evaluated but rejected in favour of NETWORK_SIMPLEX because it breaks happy-path Y alignment by placing gateway branches symmetrically rather than keeping the default branch on the main row.
