/**
 * Custom bpmnlint rule: user-task-missing-assignee
 *
 * Warns when a bpmn:UserTask does not have at least one of:
 *   - camunda:assignee
 *   - camunda:candidateUsers
 *   - camunda:candidateGroups
 *
 * Without any of these, the Camunda 7 (Operaton) engine creates the
 * task but nobody can claim it, making the process stuck.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:UserTask')) {
      return;
    }

    const assignee = node.$attrs?.['camunda:assignee'] ?? node.assignee;
    const candidateUsers = node.$attrs?.['camunda:candidateUsers'] ?? node.candidateUsers;
    const candidateGroups = node.$attrs?.['camunda:candidateGroups'] ?? node.candidateGroups;

    if (!assignee && !candidateUsers && !candidateGroups) {
      reporter.report(
        node.id,
        'User task has no assignee, candidateUsers, or candidateGroups — ' +
          'the task will be created but nobody can claim it'
      );
    }
  }

  return { check };
}

export default ruleFactory;
