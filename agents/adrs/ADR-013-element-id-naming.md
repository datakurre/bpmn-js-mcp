# ADR-013: 2-part element ID naming with 3-part fallback

## Status

Accepted

## Decision

bpmn-js generates IDs like `Activity_0m4w27p` with random hex suffixes but no semantic meaning. Our approach prefers short, readable 2-part IDs: `UserTask_EnterName` when a name is given. On collision (same name used twice), it falls back to 3-part IDs with a random middle section: `UserTask_a1b2c3d_EnterName`. Unnamed elements always use a random part: `StartEvent_x9y8z7w`. The random 7-character alphanumeric part ensures reasonable uniqueness, making elements safe to copy/paste across diagrams without ID collisions. The same pattern applies to flows via `generateFlowId()`: `Flow_Done` first, then `Flow_m4n5p6q_Done` on collision, or `Flow_x9y8z7w` when no names are available.
