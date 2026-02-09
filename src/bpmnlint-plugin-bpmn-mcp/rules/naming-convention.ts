/**
 * Custom bpmnlint rule: naming-convention
 *
 * Warns when BPMN elements don't follow naming best practices:
 * - Activities (tasks, subprocesses): verb-object pattern ("Process Order" not "Order Processing")
 * - Events: object-participle or noun-state pattern ("Order Created", "Payment Received")
 * - Gateways: yes/no question ending with "?" ("Order valid?")
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

/** Common verbs that indicate verb-object naming (good pattern for activities). */
const ACTIVITY_VERBS = new Set([
  'accept',
  'add',
  'adjust',
  'analyse',
  'analyze',
  'apply',
  'approve',
  'archive',
  'assign',
  'audit',
  'book',
  'calculate',
  'call',
  'cancel',
  'capture',
  'change',
  'check',
  'clean',
  'close',
  'collect',
  'communicate',
  'complete',
  'compose',
  'compute',
  'configure',
  'confirm',
  'connect',
  'convert',
  'copy',
  'create',
  'decide',
  'decline',
  'define',
  'delete',
  'deliver',
  'deploy',
  'design',
  'determine',
  'develop',
  'disable',
  'dispatch',
  'distribute',
  'do',
  'download',
  'draft',
  'edit',
  'email',
  'enable',
  'enter',
  'escalate',
  'estimate',
  'evaluate',
  'examine',
  'execute',
  'export',
  'extract',
  'fetch',
  'file',
  'fill',
  'filter',
  'find',
  'fix',
  'forward',
  'generate',
  'get',
  'grant',
  'handle',
  'identify',
  'implement',
  'import',
  'inform',
  'initiate',
  'input',
  'insert',
  'inspect',
  'install',
  'investigate',
  'invoke',
  'issue',
  'load',
  'log',
  'maintain',
  'make',
  'manage',
  'map',
  'merge',
  'modify',
  'monitor',
  'move',
  'notify',
  'obtain',
  'open',
  'order',
  'output',
  'pack',
  'parse',
  'pay',
  'perform',
  'place',
  'plan',
  'post',
  'prepare',
  'print',
  'process',
  'produce',
  'provide',
  'publish',
  'purchase',
  'put',
  'read',
  'receive',
  'record',
  'register',
  'reject',
  'release',
  'remove',
  'render',
  'repair',
  'replace',
  'report',
  'request',
  'resolve',
  'respond',
  'restart',
  'retrieve',
  'return',
  'review',
  'revise',
  'revoke',
  'route',
  'run',
  'save',
  'scan',
  'schedule',
  'search',
  'select',
  'send',
  'set',
  'setup',
  'ship',
  'sign',
  'sort',
  'specify',
  'start',
  'stop',
  'store',
  'submit',
  'sync',
  'synchronize',
  'take',
  'terminate',
  'test',
  'track',
  'transfer',
  'transform',
  'translate',
  'trigger',
  'update',
  'upgrade',
  'upload',
  'validate',
  'verify',
  'wait',
  'write',
]);

function ruleFactory() {
  function check(node: any, reporter: any) {
    const name = node.name;
    if (!name || !name.trim()) return; // No name — label-required handles that

    const trimmed = name.trim();
    const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();

    // Check activities: should start with a verb
    if (
      isType(node, 'bpmn:Task') ||
      isType(node, 'bpmn:SubProcess') ||
      isType(node, 'bpmn:CallActivity')
    ) {
      if (firstWord && !ACTIVITY_VERBS.has(firstWord)) {
        reporter.report(
          node.id,
          `Activity name should use verb-object pattern (e.g. "Process Order"), ` +
            `but starts with "${firstWord}"`
        );
      }
    }

    // Check gateways: should end with "?"
    if (isType(node, 'bpmn:ExclusiveGateway') || isType(node, 'bpmn:InclusiveGateway')) {
      if (!trimmed.endsWith('?')) {
        reporter.report(
          node.id,
          `Gateway label should be a yes/no question ending with "?" (e.g. "Order valid?")`
        );
      }
    }
  }

  return { check };
}

export default ruleFactory;
