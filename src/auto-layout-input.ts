/**
 * Preparation of the BPMN XML handed to `bpmn-auto-layout`
 * (see src/auto-layout.ts): normalising inputs the layout engine would
 * misinterpret, and extracting element subsets for partial layout.
 */

// ── Input normalisation ────────────────────────────────────────────────────

/**
 * Move boundary events into their host's lane.
 *
 * A boundary event can end up referenced by a different lane than its host
 * (e.g. when it was created at a position overlapping a neighbouring lane).
 * The layout engine keeps a host and its boundary events together and would
 * pull the host — and everything connected to it — into the wrong lane.
 */
function syncBoundaryEventLanes(definitions: any): void {
  const lanes: any[] = [];
  const collect = (laneSet: any): void => {
    for (const lane of laneSet?.lanes || []) {
      lanes.push(lane);
      collect(lane.childLaneSet);
    }
  };
  for (const root of definitions.rootElements || []) {
    for (const laneSet of root.laneSets || []) collect(laneSet);
  }
  const leafLanes = lanes.filter((l) => !l.childLaneSet?.lanes?.length);
  const laneOf = (node: any) => leafLanes.find((l) => (l.flowNodeRef || []).includes(node));

  for (const lane of leafLanes) {
    for (const node of [...(lane.flowNodeRef || [])]) {
      if (node.$type !== 'bpmn:BoundaryEvent' || !node.attachedToRef) continue;
      const hostLane = laneOf(node.attachedToRef);
      if (!hostLane || hostLane === lane) continue;
      lane.flowNodeRef.splice(lane.flowNodeRef.indexOf(node), 1);
      hostLane.flowNodeRef.push(node);
    }
  }
}

/** Parse, normalise and re-serialise XML before handing it to the layout engine. */
export async function prepareXml(moddle: any, xml: string): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(xml);
  syncBoundaryEventLanes(definitions);
  const { xml: prepared } = await moddle.toXML(definitions);
  return prepared;
}

// ── Subset extraction ──────────────────────────────────────────────────────

/**
 * Build a standalone process XML that only contains the given sibling flow
 * elements, the boundary events attached to them, and the flows/associations
 * connecting them.  Used to lay out an arbitrary element subset in isolation.
 */
export async function buildSubsetXml(moddle: any, xml: string, ids: Set<string>): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const container = findCommonContainer(definitions, ids);

  const flowElements: any[] = container.flowElements || [];
  // Boundary events follow their host.
  for (const el of flowElements) {
    if (el.$type === 'bpmn:BoundaryEvent' && ids.has(el.attachedToRef?.id)) ids.add(el.id);
  }
  const keep = (el: any): boolean => {
    if (el.$type === 'bpmn:SequenceFlow') {
      return ids.has(el.sourceRef?.id) && ids.has(el.targetRef?.id);
    }
    return ids.has(el.id);
  };
  const artifacts = (container.artifacts || []).filter((a: any) =>
    a.$type === 'bpmn:Association'
      ? ids.has(a.sourceRef?.id) && ids.has(a.targetRef?.id)
      : ids.has(a.id)
  );

  const process = moddle.create('bpmn:Process', {
    id: `${container.id}_subset`,
    isExecutable: false,
    flowElements: flowElements.filter(keep),
    artifacts,
  });
  definitions.rootElements = [
    ...definitions.rootElements.filter(
      (r: any) => r.$type !== 'bpmn:Process' && r.$type !== 'bpmn:Collaboration'
    ),
    process,
  ];
  definitions.diagrams = [];
  const { xml: subsetXml } = await moddle.toXML(definitions);
  return subsetXml;
}

/** Find the Process/SubProcess that directly contains all given flow elements. */
function findCommonContainer(definitions: any, ids: Set<string>): any {
  let found: any;
  const visit = (container: any): void => {
    for (const el of container.flowElements || []) {
      if (ids.has(el.id)) {
        if (found && found !== container) {
          throw new Error(
            'elementIds must all belong to the same process or subprocess ' +
              `(found elements in both '${found.id}' and '${container.id}')`
          );
        }
        found = container;
      }
      if (el.flowElements) visit(el);
    }
  };
  for (const root of definitions.rootElements || []) {
    if (root.$type === 'bpmn:Process') visit(root);
  }
  if (!found) throw new Error('None of the given elementIds are flow elements of this diagram');
  const missing = [...ids].filter(
    (id) =>
      !(found.flowElements || []).some((el: any) => el.id === id) &&
      !(found.artifacts || []).some((el: any) => el.id === id)
  );
  if (missing.length > 0) {
    throw new Error(
      `elementIds must all belong to '${found.id}'; not found there: ${missing.join(', ')}`
    );
  }
  return found;
}
