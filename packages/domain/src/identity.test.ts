import { describe, expect, it } from "vitest";
import { playerRoles } from "./identity.js";

describe("identity vocabulary", () => {
  it("keeps ordinary and administrative capability server authoritative", () => {
    expect(playerRoles).toEqual(["player", "administrator"]);
  });
});
