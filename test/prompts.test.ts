/**
 * Tests for MCP prompts.
 */
import { describe, test, expect } from 'vitest';
import { listPrompts, getPrompt } from '../src/prompts';

describe('listPrompts', () => {
  test('returns all prompt definitions', () => {
    const prompts = listPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(7);
    const names = prompts.map((p) => p.name);
    expect(names).toContain('create-executable-process');
    expect(names).toContain('convert-to-collaboration');
    expect(names).toContain('add-sla-timer-pattern');
    expect(names).toContain('add-approval-pattern');
    expect(names).toContain('add-error-handling-pattern');
    expect(names).toContain('add-parallel-tasks-pattern');
    expect(names).toContain('create-lane-based-process');
  });

  test('each prompt has name, title, and description', () => {
    for (const prompt of listPrompts()) {
      expect(prompt.name).toBeTruthy();
      expect(prompt.title).toBeTruthy();
      expect(prompt.description).toBeTruthy();
    }
  });
});

describe('getPrompt', () => {
  test('returns messages for create-executable-process', () => {
    const result = getPrompt('create-executable-process', { processName: 'Order Processing' });
    expect(result.description).toBeTruthy();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.text).toContain('Order Processing');
    expect(result.messages[0].content.text).toContain('create_bpmn_diagram');
  });

  test('returns messages for convert-to-collaboration', () => {
    const result = getPrompt('convert-to-collaboration', {
      diagramId: 'test-123',
      partners: 'Customer, Payment Gateway',
    });
    expect(result.messages[0].content.text).toContain('test-123');
    expect(result.messages[0].content.text).toContain('Customer, Payment Gateway');
  });

  test('returns messages for add-sla-timer-pattern', () => {
    const result = getPrompt('add-sla-timer-pattern', {
      diagramId: 'd1',
      targetElementId: 'Task_1',
      duration: 'PT2H',
    });
    expect(result.messages[0].content.text).toContain('PT2H');
    expect(result.messages[0].content.text).toContain('Task_1');
  });

  test('returns messages for add-approval-pattern', () => {
    const result = getPrompt('add-approval-pattern', {
      diagramId: 'd1',
      afterElementId: 'Task_1',
      approverGroup: 'managers',
    });
    expect(result.messages[0].content.text).toContain('managers');
    expect(result.messages[0].content.text).toContain('Task_1');
  });

  test('throws on unknown prompt', () => {
    expect(() => getPrompt('nonexistent')).toThrow('Unknown prompt');
  });

  test('returns messages for add-error-handling-pattern', () => {
    const result = getPrompt('add-error-handling-pattern', {
      diagramId: 'd1',
      targetElementId: 'ServiceTask_1',
      errorCode: 'PAYMENT_FAILED',
    });
    expect(result.messages[0].content.text).toContain('PAYMENT_FAILED');
    expect(result.messages[0].content.text).toContain('ServiceTask_1');
    expect(result.messages[0].content.text).toContain('BoundaryEvent');
    expect(result.messages[0].content.text).toContain('ErrorEventDefinition');
  });

  test('returns messages for add-parallel-tasks-pattern', () => {
    const result = getPrompt('add-parallel-tasks-pattern', {
      diagramId: 'd1',
      afterElementId: 'Task_1',
      branches: 'Check Stock, Process Payment, Send Email',
    });
    expect(result.messages[0].content.text).toContain('Check Stock');
    expect(result.messages[0].content.text).toContain('Process Payment');
    expect(result.messages[0].content.text).toContain('Send Email');
    expect(result.messages[0].content.text).toContain('ParallelGateway');
  });

  test('returns messages for create-lane-based-process', () => {
    const result = getPrompt('create-lane-based-process', {
      processName: 'Helpdesk Workflow',
      roles: 'Customer Service, Technical Support, Management',
    });
    expect(result.messages[0].content.text).toContain('Helpdesk Workflow');
    expect(result.messages[0].content.text).toContain('Customer Service');
    expect(result.messages[0].content.text).toContain('Technical Support');
    expect(result.messages[0].content.text).toContain('lanes');
    expect(result.messages[0].content.text).toContain('create_bpmn_lanes');
    expect(result.messages[0].content.text).toContain('assign_bpmn_elements_to_lane');
  });

  test('uses defaults for missing arguments', () => {
    const result = getPrompt('create-executable-process', {});
    expect(result.messages[0].content.text).toContain('My Process');
  });
});
