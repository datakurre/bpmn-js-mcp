import { handleCreateDiagram, handleAddElement } from "../src/handlers";
import { clearDiagrams } from "../src/diagram-manager";

export function parseResult(result: any) {
  return JSON.parse(result.content[0].text);
}

export async function createDiagram(name?: string) {
  return parseResult(await handleCreateDiagram({ name })).diagramId as string;
}

export async function addElement(
  diagramId: string,
  elementType: string,
  opts: Record<string, any> = {},
) {
  return parseResult(
    await handleAddElement({ diagramId, elementType, ...opts }),
  ).elementId as string;
}

export { clearDiagrams };
