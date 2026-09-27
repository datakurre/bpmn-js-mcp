/**
 * Unit tests for the pure logic in `src/mcp-apps/viewer-entry.ts` (issue #11
 * / ADR-025's browser-side MCP Apps View). The DOM-touching glue (finding
 * the container element, calling `window.TokenSimulation`) is a thin,
 * obviously-correct sliver covered by a manual browser-bundle spike instead
 * — these tests exercise the two functions that actually have logic:
 * extracting the embedded diagram XML from a tool result, and base64
 * round-tripping it safely for non-Latin1 text.
 */
import { describe, test, expect } from 'vitest';
import { extractDiagramXml, base64EncodeUtf8, CONTAINER_ID } from '../src/mcp-apps/viewer-entry';

describe('extractDiagramXml', () => {
  test('finds the embedded XML resource content item', () => {
    const content = [
      { type: 'text', text: '{"success":true}' },
      {
        type: 'resource',
        resource: { uri: 'bpmn://diagram/d1/xml', mimeType: 'application/xml', text: '<xml/>' },
        annotations: { audience: ['user'] },
      },
    ];
    expect(extractDiagramXml(content)).toBe('<xml/>');
  });

  test('returns undefined when no resource content item is present', () => {
    const content = [{ type: 'text', text: '{"success":true}' }];
    expect(extractDiagramXml(content)).toBeUndefined();
  });

  test('returns undefined for a resource item with a different mimeType (e.g. SVG)', () => {
    const content = [
      {
        type: 'resource',
        resource: { uri: 'bpmn://diagram/d1/svg', mimeType: 'image/svg+xml', text: '<svg/>' },
      },
    ];
    expect(extractDiagramXml(content)).toBeUndefined();
  });

  test('returns undefined for undefined/empty content', () => {
    expect(extractDiagramXml(undefined)).toBeUndefined();
    expect(extractDiagramXml([])).toBeUndefined();
  });

  test('ignores malformed/non-object content items without throwing', () => {
    const content = [null, 42, 'a string', { type: 'resource' }];
    expect(extractDiagramXml(content)).toBeUndefined();
  });
});

describe('base64EncodeUtf8', () => {
  test('round-trips plain ASCII XML', () => {
    const xml = '<bpmn:definitions id="Definitions_1"></bpmn:definitions>';
    const encoded = base64EncodeUtf8(xml);
    expect(Buffer.from(encoded, 'base64').toString('utf-8')).toBe(xml);
  });

  test('round-trips text outside Latin-1 (e.g. a diagram name with emoji/CJK)', () => {
    const xml = '<bpmn:process name="Coffee ☕ 検証プロセス"/>';
    const encoded = base64EncodeUtf8(xml);
    expect(Buffer.from(encoded, 'base64').toString('utf-8')).toBe(xml);
  });

  test('plain btoa would throw on text outside Latin-1 (regression guard)', () => {
    const xml = '<bpmn:process name="Coffee ☕"/>';
    expect(() => btoa(xml)).toThrow();
  });
});

test('CONTAINER_ID is a stable, non-empty DOM id', () => {
  expect(CONTAINER_ID).toBe('bpmn-app-view');
});
