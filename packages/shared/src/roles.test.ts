import { describe, expect, it } from "vitest";
import { isRole, ROLE_LABELS, ROLES } from "./roles.js";

describe("roles (Q13)", () => {
  it("v1 tem exatamente member, caller, staff e admin com rótulo PT-BR", () => {
    expect(ROLES).toEqual(["member", "caller", "staff", "admin"]);
    expect(Object.keys(ROLE_LABELS)).toEqual([...ROLES]);
  });

  it.each([["staff", true], ["owner", false], [1, false], [null, false]])("isRole(%j) = %s", (value, expected) => {
    expect(isRole(value)).toBe(expected);
  });
});
