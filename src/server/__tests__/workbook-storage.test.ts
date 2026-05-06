import { describe, expect, it, vi } from "vitest";

import {
  buildWorkbookObjectKey,
  storeUploadedWorkbook,
  WorkbookStorageConfigError,
} from "@/server/storage/workbooks";

const fileBytes = new TextEncoder().encode("receivables workbook bytes");
const fileSha256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("workbook storage", () => {
  it("returns a local development reference when object storage is not configured outside production", async () => {
    const fetchImpl = vi.fn();

    const result = await storeUploadedWorkbook({
      fileBytes,
      fileName: "../Grp Bills May 2026.xlsx",
      entityCode: "IND",
      snapshotId: "snapshot-123",
      fileSha256,
      env: { NODE_ENV: "development" },
      fetchImpl,
      now: new Date("2026-05-06T00:00:00.000Z"),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({
      stored: false,
      key: null,
      uri: "local-dev://Grp_Bills_May_2026.xlsx",
    });
  });

  it("throws in production when object storage is incomplete", async () => {
    await expect(
      storeUploadedWorkbook({
        fileBytes,
        fileName: "GrpBills.xlsx",
        entityCode: "IND",
        snapshotId: "snapshot-123",
        fileSha256,
        env: {
          NODE_ENV: "production",
          S3_BUCKET: "receivables-workbooks",
        },
        fetchImpl: vi.fn(),
        now: new Date("2026-05-06T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(WorkbookStorageConfigError);
  });

  it("builds a deterministic workbook object key", () => {
    expect(
      buildWorkbookObjectKey({
        entityCode: "UAE",
        snapshotId: "snapshot-456",
        fileSha256,
        fileName: "MANTARAV Aged Receivables Detail.xlsx",
      }),
    ).toBe(
      "workbooks/UAE/snapshot-456/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-MANTARAV_Aged_Receivables_Detail.xlsx",
    );
  });

  it("puts configured uploads to S3-compatible object storage and returns the object URI", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    const result = await storeUploadedWorkbook({
      fileBytes,
      fileName: "GrpBills.xlsx",
      entityCode: "IND",
      snapshotId: "snapshot-123",
      fileSha256,
      env: {
        NODE_ENV: "production",
        S3_BUCKET: "receivables-workbooks",
        S3_REGION: "auto",
        S3_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
        S3_ACCESS_KEY_ID: "access-key",
        S3_SECRET_ACCESS_KEY: "secret-key",
      },
      fetchImpl,
      now: new Date("2026-05-06T00:00:00.000Z"),
    });

    expect(result).toEqual({
      stored: true,
      key: "workbooks/IND/snapshot-123/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-GrpBills.xlsx",
      uri: "s3://receivables-workbooks/workbooks/IND/snapshot-123/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-GrpBills.xlsx",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(
      "https://account-id.r2.cloudflarestorage.com/receivables-workbooks/workbooks/IND/snapshot-123/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-GrpBills.xlsx",
    );
    expect(init.method).toBe("PUT");
    expect(init.body).toEqual(Buffer.from(fileBytes));
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(init.headers["x-amz-date"]).toBe("20260506T000000Z");
    expect(init.headers["x-amz-content-sha256"]).toBe(
      "e8baa37532df540a491503b849ced48f8bb20f2b438ee7853f817260348ee286",
    );
  });
});
