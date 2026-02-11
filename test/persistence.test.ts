/**
 * Persistence tests for src/persistence.ts.
 *
 * Tests enablePersistence, loadDiagrams, saveDiagram, and removePersisted.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  enablePersistence,
  disablePersistence,
  isPersistenceEnabled,
  getPersistDir,
  persistDiagram,
  persistAllDiagrams,
  removePersisted,
} from '../src/persistence';
import { clearDiagrams, storeDiagram, createModeler, getDiagram } from '../src/diagram-manager';

describe('persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearDiagrams();
    disablePersistence();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-js-mcp-persist-'));
  });

  afterEach(() => {
    disablePersistence();
    clearDiagrams();
    // Clean up temp dir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('isPersistenceEnabled returns false by default', () => {
    expect(isPersistenceEnabled()).toBe(false);
    expect(getPersistDir()).toBeNull();
  });

  test('enablePersistence sets the directory and returns loaded count', async () => {
    const count = await enablePersistence(tmpDir);
    expect(isPersistenceEnabled()).toBe(true);
    expect(getPersistDir()).toBe(path.resolve(tmpDir));
    expect(count).toBe(0); // Empty dir
  });

  test('enablePersistence creates directory if it does not exist', async () => {
    const newDir = path.join(tmpDir, 'sub', 'dir');
    expect(fs.existsSync(newDir)).toBe(false);
    await enablePersistence(newDir);
    expect(fs.existsSync(newDir)).toBe(true);
  });

  test('disablePersistence clears the directory', async () => {
    await enablePersistence(tmpDir);
    expect(isPersistenceEnabled()).toBe(true);
    disablePersistence();
    expect(isPersistenceEnabled()).toBe(false);
    expect(getPersistDir()).toBeNull();
  });

  test('persistDiagram saves a .bpmn and .meta.json file', async () => {
    await enablePersistence(tmpDir);

    const modeler = await createModeler();
    const { xml } = await modeler.saveXML({ format: true });
    storeDiagram('test-diagram-1', { modeler, xml: xml || '', name: 'Test Diagram' });

    const diagram = getDiagram('test-diagram-1')!;
    await persistDiagram('test-diagram-1', diagram);

    const bpmnFile = path.join(tmpDir, 'test-diagram-1.bpmn');
    const metaFile = path.join(tmpDir, 'test-diagram-1.meta.json');

    expect(fs.existsSync(bpmnFile)).toBe(true);
    expect(fs.existsSync(metaFile)).toBe(true);

    const content = fs.readFileSync(bpmnFile, 'utf-8');
    expect(content).toContain('<bpmn:definitions');

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    expect(meta.name).toBe('Test Diagram');
  });

  test('persistDiagram is a no-op when persistence is disabled', async () => {
    const modeler = await createModeler();
    const { xml } = await modeler.saveXML({ format: true });
    storeDiagram('test-diagram-2', { modeler, xml: xml || '', name: 'No Persist' });

    const diagram = getDiagram('test-diagram-2')!;
    await persistDiagram('test-diagram-2', diagram);

    // No files should be created
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(0);
  });

  test('persistAllDiagrams saves all in-memory diagrams', async () => {
    await enablePersistence(tmpDir);

    const modeler1 = await createModeler();
    const { xml: xml1 } = await modeler1.saveXML({ format: true });
    storeDiagram('d1', { modeler: modeler1, xml: xml1 || '', name: 'D1' });

    const modeler2 = await createModeler();
    const { xml: xml2 } = await modeler2.saveXML({ format: true });
    storeDiagram('d2', { modeler: modeler2, xml: xml2 || '', name: 'D2' });

    const count = await persistAllDiagrams();
    expect(count).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, 'd1.bpmn'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'd2.bpmn'))).toBe(true);
  });

  test('removePersisted deletes .bpmn and .meta.json files', async () => {
    await enablePersistence(tmpDir);

    const modeler = await createModeler();
    const { xml } = await modeler.saveXML({ format: true });
    storeDiagram('to-remove', { modeler, xml: xml || '', name: 'Remove Me' });

    const diagram = getDiagram('to-remove')!;
    await persistDiagram('to-remove', diagram);
    expect(fs.existsSync(path.join(tmpDir, 'to-remove.bpmn'))).toBe(true);

    await removePersisted('to-remove');
    expect(fs.existsSync(path.join(tmpDir, 'to-remove.bpmn'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'to-remove.meta.json'))).toBe(false);
  });

  test('enablePersistence loads existing .bpmn files', async () => {
    // Write a BPMN file manually to the tmp dir
    const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    fs.writeFileSync(path.join(tmpDir, 'loaded-diagram.bpmn'), bpmnXml, 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'loaded-diagram.meta.json'),
      JSON.stringify({ name: 'Loaded' }),
      'utf-8'
    );

    const count = await enablePersistence(tmpDir);
    expect(count).toBe(1);

    const diagram = getDiagram('loaded-diagram');
    expect(diagram).toBeDefined();
    expect(diagram!.name).toBe('Loaded');
  });
});
