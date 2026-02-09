# ADR-012: Geometry-based label adjustment

## Status

Accepted

## Decision

bpmn-js has `AdaptiveLabelPositioningBehavior` but it only considers connection direction quadrants, not actual bounding-box intersection. Our approach scores 4 candidate positions (top/bottom/left/right) against all connection segments and other labels using Cohen-Sutherland intersection tests, picking the position with the lowest collision score.
