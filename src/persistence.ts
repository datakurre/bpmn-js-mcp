/**
 * Optional file-backed persistence for BPMN diagrams.
 *
 * When enabled via `enablePersistence(dir)`, diagrams are automatically
 * saved to `.bpmn` files in the specified directory after mutations,
 * and loaded on startup.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAllDiagrams, storeDiagram, createModelerFromXml } from './diagram-manager';
import { type DiagramState } from './types';

let persistDir: string | null = null;

/**
 * Enable file-backed persistence.  Diagrams will be saved to `dir`
 * as `<diagramId>.bpmn` files.  Existing `.bpmn` files in the
 * directory are loaded into memory.
 */
export async function enablePersistence(dir: string): Promise<number> {
  persistDir = path.resolve(dir);
  if (!fs.existsSync(persistDir)) {
    fs.mkdirSync(persistDir, { recursive: true });
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
 * Save a single diagram to disk (if persistence is enabled).
 * After writing, re-reads the file and validates the XML can be parsed
 * to catch any corruption early.
 */
export async function persistDiagram(diagramId: string, diagram: DiagramState): Promise<void> {
  if (!persistDir) return;
  try {
    const { xml } = await diagram.modeler.saveXML({ format: true });
    const filePath = path.join(persistDir, `${diagramId}.bpmn`);
    const meta = { name: diagram.name };
    const metaPath = path.join(persistDir, `${diagramId}.meta.json`);
    fs.writeFileSync(filePath, xml || '', 'utf-8');
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');

    // Post-write validation: re-read and verify XML integrity
    const written = fs.readFileSync(filePath, 'utf-8');
    if (!written.includes('</bpmn:definitions>') && !written.includes('</definitions>')) {
      console.error(
        `[persistence] Post-write validation failed for ${diagramId}: ` +
          'written file is missing closing </bpmn:definitions> tag'
      );
    }
  } catch {
    // Persistence failures are non-fatal
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
  const files = fs.readdirSync(persistDir).filter((f) => f.endsWith('.bpmn'));

  for (const file of files) {
    try {
      const diagramId = file.replace('.bpmn', '');
      const filePath = path.join(persistDir, file);
      const xml = fs.readFileSync(filePath, 'utf-8');
      const metaPath = path.join(persistDir, `${diagramId}.meta.json`);
      let name: string | undefined;
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          name = meta.name;
        } catch {
          // ignore malformed meta
        }
      }

      const modeler = await createModelerFromXml(xml);
      storeDiagram(diagramId, { modeler, xml, name });
      count++;
    } catch {
      // Skip files that fail to load
    }
  }
  return count;
}

/**
 * Remove a diagram's persisted files from disk.
 */
export function removePersisted(diagramId: string): void {
  if (!persistDir) return;
  try {
    const filePath = path.join(persistDir, `${diagramId}.bpmn`);
    const metaPath = path.join(persistDir, `${diagramId}.meta.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  } catch {
    // Non-fatal
  }
}
