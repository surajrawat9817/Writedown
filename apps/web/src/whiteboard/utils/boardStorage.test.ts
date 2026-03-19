// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { loadBoardUpdate, saveBoardUpdate } from "./boardStorage";

describe("boardStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads updates via localStorage fallback", async () => {
    const boardId = "board_test_storage";
    const update = new Uint8Array([1, 2, 3, 254, 255]);

    await saveBoardUpdate(boardId, update);
    const loaded = await loadBoardUpdate(boardId);

    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!)).toEqual(Array.from(update));
  });
});

