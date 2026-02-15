/**
 * Custom bpmnlint rule: collaboration-too-complex
 *
 * Warns when a collaboration has more than a configurable number of
 * participants (default: 3) or when the total element count across all
 * pools exceeds a threshold (default: 50), suggesting message-based
 * decomposition into separate deployable processes.
 */

import { isType } from '../utils';

const DEFAULT_MAX_PARTICIPANTS = 3;
const DEFAULT_MAX_ELEMENTS = 50;

function ruleFactory(config?: { maxParticipants?: number; maxElements?: number }) {
  const maxParticipants = config?.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
  const maxElements = config?.maxElements ?? DEFAULT_MAX_ELEMENTS;

  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const participants = node.participants || [];

    // Check participant count
    if (participants.length > maxParticipants) {
      reporter.report(
        node.id,
        `Collaboration has ${participants.length} participants (threshold: ${maxParticipants}) — ` +
          `consider decomposing into separate deployable processes communicating via messages. ` +
          `In Camunda 7 / Operaton, only one pool per deployment is executable.`
      );
    }

    // Count total flow elements across all participant processes
    let totalElements = 0;
    for (const participant of participants) {
      const process = participant.processRef;
      if (process?.flowElements) {
        totalElements += process.flowElements.length;
      }
    }

    if (totalElements > maxElements) {
      reporter.report(
        node.id,
        `Collaboration has ${totalElements} total elements across ${participants.length} pools ` +
          `(threshold: ${maxElements}) — consider decomposing into smaller, independently ` +
          `deployable processes using Call Activities, message-based integration, or ` +
          `Link events to split complex flows into readable sections within a single process.`
      );
    }
  }

  return { check };
}

export default ruleFactory;
