import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("xero admin UI", () => {
  it("ships an admin page with connect and disconnect actions", () => {
    const pageSource = readFileSync(
      join(root, "src/app/admin/xero/page.tsx"),
      "utf8",
    );
    expect(pageSource).toContain("ConnectXeroButton");
    expect(pageSource).toContain("DisconnectXeroButton");
    expect(pageSource).toContain("Xero connection");

    const connectSource = readFileSync(
      join(
        root,
        "src/app/admin/xero/_components/connect-xero-button.tsx",
      ),
      "utf8",
    );
    expect(connectSource).toContain("/api/admin/xero/connect");
  });

  it("disconnect button posts JSON to the route", () => {
    const source = readFileSync(
      join(
        root,
        "src/app/admin/xero/_components/disconnect-xero-button.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("/api/admin/xero/disconnect");
    expect(source).toContain(
      "JSON.stringify({ connection_id: connectionId })",
    );
  });

  it("guards the admin page behind ADMIN role", () => {
    const source = readFileSync(
      join(root, "src/app/admin/xero/page.tsx"),
      "utf8",
    );
    expect(source).toContain("requirePageRole");
    expect(source).toContain("role_enum.ADMIN");
  });

  it("adds a pull action to the upload form without removing manual upload", () => {
    const source = readFileSync(
      join(root, "src/app/upload/_components/upload-snapshot-form.tsx"),
      "utf8",
    );
    expect(source).toContain("/api/xero/snapshots/pull");
    expect(source).toContain("Pull from Xero");
    expect(source).toContain('type="file"');
  });
});
