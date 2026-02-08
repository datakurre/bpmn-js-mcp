import { describe, it, expect, beforeEach } from "vitest";
import { handleCreateDiagram, handleExportXml } from "../../src/handlers";
import { parseResult, createDiagram, clearDiagrams } from "../helpers";

describe("handleCreateDiagram", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it("returns success with a diagramId", async () => {
    const res = parseResult(await handleCreateDiagram({}));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });

  it("sets process name when provided", async () => {
    const diagramId = await createDiagram("My Process");
    const xml = (await handleExportXml({ diagramId })).content[0].text;
    expect(xml).toContain("My Process");
  });

  it("sets a meaningful process id based on the name", async () => {
    const diagramId = await createDiagram("Order Fulfillment");
    const xml = (await handleExportXml({ diagramId })).content[0].text;
    expect(xml).toContain('id="Process_Order_Fulfillment"');
    expect(xml).toContain("Order Fulfillment");
  });

  it("does not change process id when no name is provided", async () => {
    const diagramId = await createDiagram();
    const xml = (await handleExportXml({ diagramId })).content[0].text;
    expect(xml).toContain('id="Process_1"');
  });
});
