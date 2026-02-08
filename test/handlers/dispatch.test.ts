import { describe, it, expect, beforeEach } from "vitest";
import { dispatchToolCall } from "../../src/handlers";
import { parseResult, clearDiagrams } from "../helpers";

describe("dispatchToolCall", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it("routes create_bpmn_diagram correctly", async () => {
    const res = parseResult(
      await dispatchToolCall("create_bpmn_diagram", {}),
    );
    expect(res.success).toBe(true);
  });

  it("routes new tools correctly", async () => {
    const createRes = parseResult(
      await dispatchToolCall("create_bpmn_diagram", {}),
    );
    const diagramId = createRes.diagramId;

    // list_diagrams
    const listRes = parseResult(
      await dispatchToolCall("list_diagrams", {}),
    );
    expect(listRes.count).toBe(1);

    // validate_bpmn_diagram
    const validateRes = parseResult(
      await dispatchToolCall("validate_bpmn_diagram", { diagramId }),
    );
    expect(validateRes.issues).toBeDefined();

    // delete_diagram
    const deleteRes = parseResult(
      await dispatchToolCall("delete_diagram", { diagramId }),
    );
    expect(deleteRes.success).toBe(true);
  });

  it("throws for unknown tool", async () => {
    await expect(
      dispatchToolCall("no_such_tool", {}),
    ).rejects.toThrow(/Unknown tool/);
  });

  it("routes auto_layout backward alias to layout_diagram", async () => {
    const createRes = parseResult(
      await dispatchToolCall("create_bpmn_diagram", {}),
    );
    const diagramId = createRes.diagramId;
    const res = parseResult(
      await dispatchToolCall("auto_layout", { diagramId }),
    );
    expect(res.success).toBe(true);
    expect(res.elementCount).toBeDefined();
  });
});
