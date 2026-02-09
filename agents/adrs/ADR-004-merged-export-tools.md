# ADR-004: Merged export_bpmn_xml and export_bpmn_svg

## Status

Accepted

## Decision

Both did the same thing with different output formats. A single tool with `format: "xml" | "svg"` is cleaner.
