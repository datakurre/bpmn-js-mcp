/**
 * Export helper utilities shared between export.ts and other handlers.
 */

/**
 * Normalise the order of elements in the DI plane to match the process
 * definition order.  After `modeling.moveElements`, bpmn-js appends moved
 * shapes to the end of `plane.planeElement`, producing XML ordering that
 * differs from what Camunda Modeler generates (which serialises in process
 * definition order).  This function re-sorts the plane's children so the
 * exported XML is deterministic and matches the reference ordering.
 *
 * Sorting key: index of `bpmnElement.id` in the process `flowElements`
 * walk (depth-first to include subprocess children).  Elements not found
 * in the walk (e.g. diagram-level participants) retain their original
 * order at the end.
 */
export function normalizePlaneElementOrder(modeler: any): void {
  try {
    const definitions = modeler.getDefinitions?.();
    if (!definitions) return;

    const diagram = definitions.diagrams?.[0];
    if (!diagram?.plane?.planeElement) return;

    const plane = diagram.plane;

    // Collect all process element IDs in definition order (depth-first).
    const orderMap = new Map<string, number>();
    let idx = 0;

    function walkElements(elements: any[]): void {
      if (!Array.isArray(elements)) return;
      for (const el of elements) {
        if (el?.id) orderMap.set(el.id, idx++);
        // Descend into subprocesses and participants
        if (el?.flowElements) walkElements(el.flowElements);
        if (el?.processRef?.flowElements) walkElements(el.processRef.flowElements);
        if (el?.laneSets) {
          for (const ls of el.laneSets) {
            if (ls?.lanes) walkElements(ls.lanes);
          }
        }
      }
    }

    // Walk root elements (processes, collaborations, participants)
    for (const rootEl of definitions.rootElements || []) {
      if (rootEl?.flowElements) walkElements(rootEl.flowElements);
      if (rootEl?.participants) walkElements(rootEl.participants);
      if (rootEl?.messageFlows) walkElements(rootEl.messageFlows);
      if (rootEl?.id) orderMap.set(rootEl.id, idx++);
    }

    // Sort planeElement by the process definition order.
    // Elements not in the map are kept at the end in their original order.
    const original = plane.planeElement as any[];
    original.sort((a, b) => {
      const aId = a?.bpmnElement?.id ?? a?.id ?? '';
      const bId = b?.bpmnElement?.id ?? b?.id ?? '';
      const aIdx = orderMap.has(aId) ? orderMap.get(aId)! : Number.MAX_SAFE_INTEGER;
      const bIdx = orderMap.has(bId) ? orderMap.get(bId)! : Number.MAX_SAFE_INTEGER;
      return aIdx - bIdx;
    });
  } catch {
    // Non-fatal: if sorting fails, export continues with original order
  }
}
