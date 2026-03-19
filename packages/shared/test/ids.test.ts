import { describe, expect, it } from "vitest";
import { createId } from "../src/utils/ids";

describe("createId", () => {
  it("creates stable prefix ids", () => {
    const id = createId("board");
    expect(id.startsWith("board_")).toBe(true);
    expect(id.length).toBeGreaterThan("board_".length);
  });
});

