/**
 * @internal
 * Descriptive ID generation for BPMN elements and flows.
 *
 * Produces short 2-part IDs (e.g. `UserTask_EnterName`) with collision
 * fallback to 3-part IDs (e.g. `UserTask_a1b2c3d_EnterName`).
 */

/**
 * Generate a 7-character random alphanumeric string (lowercase).
 * Mimics bpmn-js default random suffix format.
 */
function generateRandomPart(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Convert a human-readable name into a PascalCase slug suitable for BPMN IDs.
 * Strips non-alphanumeric chars, collapses whitespace, PascalCases each word.
 */
function toPascalSlug(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** Map full BPMN type to a short prefix for element IDs. */
function typePrefix(bpmnType: string): string {
  // e.g. "bpmn:UserTask" → "UserTask", "bpmn:ExclusiveGateway" → "Gateway"
  const short = bpmnType.replace('bpmn:', '');
  if (short.includes('Gateway')) return 'Gateway';
  if (short === 'StartEvent' || short === 'EndEvent') return short;
  if (short.includes('Event')) return 'Event';
  if (short === 'SubProcess') return 'SubProcess';
  if (short === 'CallActivity') return 'CallActivity';
  if (short.includes('Task')) return short; // UserTask, ServiceTask…
  if (short === 'TextAnnotation') return 'Annotation';
  if (short === 'DataObjectReference') return 'DataObject';
  if (short === 'DataStoreReference') return 'DataStore';
  if (short === 'Group') return 'Group';
  if (short === 'Participant') return 'Participant';
  if (short === 'Lane') return 'Lane';
  return short;
}

/**
 * Generate a descriptive element ID.
 *
 * Prefers short 2-part IDs: `UserTask_EnterName` or `StartEvent_<random7>`.
 * Falls back to 3-part IDs on collision: `UserTask_<random7>_EnterName`.
 *
 * Named elements get a clean slug first; unnamed elements always include a
 * random 7-char alphanumeric part for uniqueness.
 */
export function generateDescriptiveId(
  elementRegistry: any,
  bpmnType: string,
  name?: string
): string {
  const prefix = typePrefix(bpmnType);

  if (name) {
    const slug = toPascalSlug(name);
    if (slug) {
      // Try short 2-part ID first: UserTask_EnterName
      const candidate = `${prefix}_${slug}`;
      if (!elementRegistry.get(candidate)) return candidate;

      // Collision — fall back to 3-part ID: UserTask_<random7>_EnterName
      let fallback: string;
      let attempts = 0;
      do {
        fallback = `${prefix}_${generateRandomPart()}_${slug}`;
        attempts++;
      } while (elementRegistry.get(fallback) && attempts < 100);
      return fallback;
    }
  }

  // No name (or empty slug) — 2-part with random: StartEvent_<random7>
  let candidate: string;
  let attempts = 0;
  do {
    candidate = `${prefix}_${generateRandomPart()}`;
    attempts++;
  } while (elementRegistry.get(candidate) && attempts < 100);
  return candidate;
}

/**
 * Generate a descriptive ID for a sequence flow / connection.
 *
 * Prefers short 2-part IDs: `Flow_Done` or `Flow_Begin_to_Finish`.
 * Falls back to 3-part IDs on collision: `Flow_<random7>_Done`.
 * When no label/names are available: `Flow_<random7>`.
 */
export function generateFlowId(
  elementRegistry: any,
  sourceName?: string,
  targetName?: string,
  label?: string
): string {
  let slug: string | undefined;
  if (label) {
    slug = toPascalSlug(label);
  } else if (sourceName && targetName) {
    slug = `${toPascalSlug(sourceName)}_to_${toPascalSlug(targetName)}`;
  }

  if (slug) {
    // Try short 2-part ID first: Flow_Done
    const candidate = `Flow_${slug}`;
    if (!elementRegistry.get(candidate)) return candidate;

    // Collision — fall back to 3-part ID: Flow_<random7>_Done
    let fallback: string;
    let attempts = 0;
    do {
      fallback = `Flow_${generateRandomPart()}_${slug}`;
      attempts++;
    } while (elementRegistry.get(fallback) && attempts < 100);
    return fallback;
  }

  // No names available — 2-part with random: Flow_<random7>
  let candidate: string;
  let attempts = 0;
  do {
    candidate = `Flow_${generateRandomPart()}`;
    attempts++;
  } while (elementRegistry.get(candidate) && attempts < 100);
  return candidate;
}
