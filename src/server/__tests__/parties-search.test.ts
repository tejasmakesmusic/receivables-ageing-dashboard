import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("searchParties", () => {
  const src = readFileSync(
    resolve(__dirname, "../parties/search.ts"),
    "utf-8",
  );

  it("scopes ANALYST to their entity_id", () => {
    expect(src).toContain("where.entity_id = currentUser.entityIdScope");
  });

  it("throws when ANALYST has no entityIdScope", () => {
    expect(src).toContain("Analyst user has no entity scope");
  });

  it("filters by name contains case-insensitive", () => {
    expect(src).toContain('mode: "insensitive"');
  });

  it("filters by entity_code when provided", () => {
    expect(src).toContain("where.entities = { code: entityCode }");
  });

  it("limits results by pageSize", () => {
    expect(src).toContain("take: pageSize");
  });

  it("orders results by name asc", () => {
    expect(src).toContain('orderBy: { name: "asc" }');
  });
});
