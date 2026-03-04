/**
 * Optional file-backed persistence for BPMN diagrams.
 *
 * When enabled via `enablePersistence(dir)`, diagrams are automatically
 * saved to `.bpmn` files in the specified directory after mutations,
 * and loaded on startup.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { getAllDiagrams, storeDiagram, createModelerFromXml } from './diagram-manager';
import { type DiagramState } from './types';

/** Lightweight XML well-formedness check using the built-in DOMParser substitute. */
async function validatePersistedXml(filePath: string, diagramId: string): Promise<void> {
  const written = await fs.readFile(filePath, 'utf-8');
  // Structural check: the file must contain a recognised closing tag.
  if (!written.includes('</bpmn:definitions>') && !written.includes('</definitions>')) {
    console.error(
      `[persistence] Post-write validation failed for ${diagramId}: ` +
        'written file is missing closing </bpmn:definitions> tag'
    );
    return;
  }
  // Parse check: attempt to re-import the XML into a temporary modeler.
  // This catches truncated writes and encoding corruption before the next
  // server start would fail to load the diagram.
  try {
    await createModelerFromXml(written);
  } catch (err) {
    console.error(`[persistence] Round-trip parse validation failed for ${diagramId}: ${err}`);
  }
}

let persistDir: string | null = null;

/**
 * Enable file-backed persistence.  Diagrams will be saved to `dir`
 * as `<diagramId>.bpmn` files.  Existing `.bpmn` files in the
 * directory are loaded into memory.
 */
export async function enablePersistence(dir: string): Promise<number> {
  persistDir = path.resolve(dir);
  if (!fsSync.existsSync(persistDir)) {
    await fs.mkdir(persistDir, { recursive: true });
  }
  return loadDiagrams();
}

/** Disable persistence. */
export function disablePersistence(): void {
  persistDir = null;
}

/** Check whether persistence is enabled. */
export function isPersistenceEnabled(): boolean {
  return persistDir !== null;
}

/** Get the persistence directory (or null). */
export function getPersistDir(): string | null {
  return persistDir;
}

/**
 * Validate that a diagram ID is safe to use as a filename component.
 *
 * IDs are server-generated (`diagram_<timestamp>_<hex>`) and safe in normal
 * operation, but we guard defensively against path traversal in case a future
 * code path allows caller-supplied IDs.
 *
 * @throws {Error} when the ID contains path separators or other dangerous characters.
 */
function assertSafeDiagramId(diagramId: string): void {
  // Allow only alphanumeric characters, underscores, and hyphens.
  if (!/^[\w-]+$/.test(diagramId)) {
    throw new Error(
      `Unsafe diagram ID rejected for persistence: "${diagramId}". ` +
        'IDs must contain only alphanumeric characters, underscores, and hyphens.'
    );
  }
}

/**
 * Save a single diagram to disk (if persistence is enabled).
 * After writing, re-reads the file and validates the XML can be parsed
 * to catch any corruption early.
 */
export async function persistDiagram(diagramId: string, diagram: DiagramState): Promise<void> {
  if (!persistDir) return;
  assertSafeDiagramId(diagramId);
  try {
    const { xml } = await diagram.modeler.saveXML({ format: true });
    const filePath = path.join(persistDir, `${diagramId}.bpmn`);
    const meta = { name: diagram.name };
    const metaPath = path.join(persistDir, `${diagramId}.meta.json`);
    await fs.writeFile(filePath, xml || '', 'utf-8');
    await fs.writeFile(metaPath, JSON.stringify(meta), 'utf-8');

    // Post-write round-trip validation: re-read and parse the written file
    // to catch truncation and encoding corruption early.
    await validatePersistedXml(filePath, diagramId);
  } catch (err) {
    console.error(`[persistence] failed to save diagram ${diagramId}:`, err);
  }
}

/**
 * Save all in-memory diagrams to disk.
 */
export async function persistAllDiagrams(): Promise<number> {
  if (!persistDir) return 0;
  let count = 0;
  for (const [id, diagram] of getAllDiagrams()) {
    await persistDiagram(id, diagram);
    count++;
  }
  return count;
}

/**
 * Load diagrams from the persistence directory into memory.
 */
async function loadDiagrams(): Promise<number> {
  if (!persistDir) return 0;
  let count = 0;
  const files = (await fs.readdir(persistDir)).filter((f) => f.endsWith('.bpmn'));

  for (const file of files) {
    try {
      const diagramId = file.replace('.bpmn', '');
      const filePath = path.join(persistDir, file);
      const xml = await fs.readFile(filePath, 'utf-8');
      const metaPath = path.join(persistDir, `${diagramId}.meta.json`);
      let name: string | undefined;
      if (fsSync.existsSync(metaPath)) {
        try {
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);
          name = meta.name;
        } catch (err) {
          console.error(`[persistence] failed to load meta for ${diagramId}:`, err);
        }
      }

      const modeler = await createModelerFromXml(xml);
      storeDiagram(diagramId, { modeler, xml, name });
      count++;
    } catch (err) {
      console.error(`[persistence] failed to load diagram ${file}:`, err);
    }
  }
  return count;
}

/**
 * Remove a diagram's persisted files from disk.
 */
export async function removePersisted(diagramId: string): Promise<void> {
  if (!persistDir) return;
  assertSafeDiagramId(diagramId);
  try {
    const filePath = path.join(persistDir, `${diagramId}.bpmn`);
    const metaPath = path.join(persistDir, `${diagramId}.meta.json`);
    if (fsSync.existsSync(filePath)) await fs.unlink(filePath);
    if (fsSync.existsSync(metaPath)) await fs.unlink(metaPath);
  } catch (err) {
    console.error(`[persistence] failed to remove persisted files for ${diagramId}:`, err);
  }
}
