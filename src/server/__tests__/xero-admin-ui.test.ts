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

  it("exposes both Xero pull and workbook upload paths from /upload", () => {
    const pageSource = readFileSync(
      join(root, "src/app/upload/page.tsx"),
      "utf8",
    );
    // The two ingestion paths are surfaced as separate cards so users
    // don't have to fill workbook fields just to trigger a Xero sync.
    expect(pageSource).toContain("XeroPullCard");
    expect(pageSource).toContain("UploadSnapshotForm");

    const xeroCard = readFileSync(
      join(root, "src/app/upload/_components/xero-pull-card.tsx"),
      "utf8",
    );
    expect(xeroCard).toContain("/api/xero/snapshots/pull");
    expect(xeroCard).toContain("Pull from Xero");

    const uploadForm = readFileSync(
      join(root, "src/app/upload/_components/upload-snapshot-form.tsx"),
      "utf8",
    );
    // The workbook form still has its file input; it must NOT silently
    // own the Xero pull anymore (that moved into XeroPullCard).
    expect(uploadForm).toContain('type="file"');
    expect(uploadForm).not.toContain("/api/xero/snapshots/pull");
  });
});
