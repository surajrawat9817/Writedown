// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { createLocalBoardSession } from "./localSession";

describe("localSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists a Yjs doc across sessions", async () => {
    const boardId = "board_test_local_session";
    const user = { id: "user_1", name: "Test", color: "#000000" };

    const a = await createLocalBoardSession({ boardId, user });
    a.doc.getMap<unknown>("board").set("hello", "world");
    a.destroy();

    const b = await createLocalBoardSession({ boardId, user });
    expect(b.doc.getMap<unknown>("board").get("hello")).toBe("world");
    b.destroy();
  });
});

