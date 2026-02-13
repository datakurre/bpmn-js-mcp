/**
 * Custom bpmnlint rule: collaboration-multiple-participants-no-messageflows
 *
 * Warns when a collaboration has 2 or more participants but zero message
 * flows.  In a collaboration diagram, participants communicate via message
 * flows — if none exist, the collaboration is likely incomplete or the
 * participants should be merged into a single process.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

export default function collaborationMultipleParticipantsNoMessageflows() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const participants = node.participants || [];
    if (participants.length < 2) return;

    const messageFlows = node.messageFlows || [];
    if (messageFlows.length > 0) return;

    reporter.report(
      node.id,
      `Collaboration has ${participants.length} participants but no message flows. ` +
        `Add message flows between pools using connect_bpmn_elements, ` +
        `or consider whether a single-pool process would be more appropriate.`
    );
  }

  return { check };
}
