import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ADMIN_PAGE = join(process.cwd(), "src", "app", "admin", "page.tsx");
const DATA_RESET_FORM = join(
  process.cwd(),
  "src",
  "app",
  "admin",
  "_components",
  "data-reset-form.tsx",
);

describe("admin data reset UI", () => {
  it("exposes a guarded imported-data reset control on the admin surface", () => {
    const adminPage = readFileSync(ADMIN_PAGE, "utf8");
    const resetForm = readFileSync(DATA_RESET_FORM, "utf8");

    expect(adminPage).toContain("DataResetForm");
    expect(adminPage).toContain("getImportedDataResetPreview");
    expect(resetForm).toContain("/api/admin/data-reset");
    expect(resetForm).toContain("RESET IMPORTED DATA");
  });
});
