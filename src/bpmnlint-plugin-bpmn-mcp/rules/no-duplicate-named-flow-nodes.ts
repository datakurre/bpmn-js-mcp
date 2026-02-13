/**
 * Custom bpmnlint rule: no-duplicate-named-flow-nodes
 *
 * Warns when the same (type, name) combination appears more than once
 * in a process or subprocess.  This catches accidental re-adds that
 * often happen in iterative AI-driven modeling sessions.
 *
 * Example (warning):
 *   Process has two bpmn:UserTask elements both named "Review Order"
 *
 * Unnamed elements are ignored (they are flagged by label-required instead).
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

export default function noDuplicateNamedFlowNodes() {
  function check(node: any, reporter: any) {
    // Only check Process and SubProcess containers
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];

    // Build a map of (type|name) → list of elements
    const seen = new Map<string, any[]>();

    for (const el of flowElements) {
      const name = el.name?.trim();
      if (!name) continue; // Skip unnamed elements

      const type = el.$type || '';
      const key = `${type}|${name}`;

      if (!seen.has(key)) {
        seen.set(key, []);
      }
      seen.get(key)!.push(el);
    }

    // Report duplicates
    for (const [, elements] of seen) {
      if (elements.length <= 1) continue;

      // Report on each duplicate (skip the first occurrence)
      for (let i = 1; i < elements.length; i++) {
        const el = elements[i];
        reporter.report(
          el.id,
          `Duplicate ${el.$type} named "${el.name}" — this (type, name) combination already exists in the process. ` +
            `Consider removing the duplicate or giving it a distinct name.`
        );
      }
    }
  }

  return { check };
}
