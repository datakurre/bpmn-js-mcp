import { describe, it, expect, beforeEach } from "vitest";
import { handleDeleteDiagram, handleExportXml } from "../../src/handlers";
import { parseResult, createDiagram, clearDiagrams } from "../helpers";

describe("handleDeleteDiagram", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it("deletes an existing diagram", async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleDeleteDiagram({ diagramId }),
    );
    expect(res.success).toBe(true);

    // Attempting to use the deleted diagram should fail
    await expect(
      handleExportXml({ diagramId }),
    ).rejects.toThrow(/Diagram not found/);
  });

  it("throws for unknown diagram", async () => {
    await expect(
      handleDeleteDiagram({ diagramId: "nope" }),
    ).rejects.toThrow(/Diagram not found/);
  });
});
