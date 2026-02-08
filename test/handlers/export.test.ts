import { describe, it, expect, beforeEach } from "vitest";
import { handleExportXml, handleExportSvg } from "../../src/handlers";
import { createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleExportXml", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it("returns BPMN XML string", async () => {
    const diagramId = await createDiagram();
    const res = await handleExportXml({ diagramId });
    expect(res.content[0].text).toContain("<bpmn:definitions");
  });

  it("warns when elements are disconnected", async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 100 });
    await addElement(diagramId, "bpmn:EndEvent", { x: 300, y: 100 });

    const res = await handleExportXml({ diagramId });
    expect(res.content.length).toBeGreaterThan(1);
    expect(res.content[1].text).toContain("flows");
  });
});

describe("handleExportSvg", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it("returns SVG markup", async () => {
    const diagramId = await createDiagram();
    const res = await handleExportSvg({ diagramId });
    expect(res.content[0].text).toContain("<svg");
  });

  it("includes connectivity warnings", async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 100 });
    await addElement(diagramId, "bpmn:EndEvent", { x: 300, y: 100 });

    const res = await handleExportSvg({ diagramId });
    expect(res.content.length).toBeGreaterThan(1);
    expect(res.content[1].text).toContain("flows");
  });
});
