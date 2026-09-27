# ADR-005: set_loop_characteristics is the canonical loop tool

## Status

Accepted. Partially superseded by [ADR-021](ADR-021-camunda-setter-consolidation.md):
`set_bpmn_element_properties`'s `loop` sub-object is now the canonical entry
point, delegating to the same handler this ADR made canonical.
`set_bpmn_loop_characteristics` remains registered only as a hidden alias.

## Decision

`set_element_properties` had a `loopCharacteristics` passthrough that duplicated the dedicated tool. The dedicated tool has a better schema with typed params. The passthrough was removed.
