import { describe, it, expect, beforeEach } from "vitest";
import { handleListDiagrams } from "../../src/handlers";
import { parseResult, createDiagram, clearDiagrams } from "../helpers";

describe("handleListDiagrams", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it("lists all diagrams", async () => {
    await createDiagram("First");
    await createDiagram("Second");

    const res = parseResult(await handleListDiagrams());
    expect(res.count).toBe(2);
    expect(res.diagrams[0].name).toBe("First");
  });

  it("returns empty when no diagrams", async () => {
    const res = parseResult(await handleListDiagrams());
    expect(res.count).toBe(0);
  });
});
