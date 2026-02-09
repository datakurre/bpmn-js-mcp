# ADR-011: Extra bottom label spacing for events

## Status

Accepted

## Decision

Start and End events are small (36×36px). With only `ELEMENT_LABEL_DISTANCE = 10` of gap, bottom-placed labels visually touch the event circle. `ELEMENT_LABEL_BOTTOM_EXTRA = 5` adds extra breathing room for the bottom position only, keeping the other three positions unchanged.
