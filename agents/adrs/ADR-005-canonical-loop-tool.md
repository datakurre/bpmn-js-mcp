# ADR-005: set_loop_characteristics is the canonical loop tool

## Status

Accepted

## Decision

`set_element_properties` had a `loopCharacteristics` passthrough that duplicated the dedicated tool. The dedicated tool has a better schema with typed params. The passthrough was removed.
