import { describe, expect, it, vi } from "vitest";

import {
  buildWorkbookObjectKey,
  storeUploadedWorkbook,
  WorkbookStorageConfigError,
  WorkbookStorageUploadError,
} from "@/server/storage/workbooks";

const fileBytes = new TextEncoder().encode("receivables workbook bytes");
const fileSha256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("workbook storage", () => {
  it("returns a local development reference when BLOB_READ_WRITE_TOKEN is not configured outside production", async () => {
    const putImpl = vi.fn();

    const result = await storeUploadedWorkbook({
      fileBytes,
      fileName: "../Grp Bills May 2026.xlsx",
      entityCode: "IND",
      snapshotId: "snapshot-123",
      fileSha256,
      env: { NODE_ENV: "development" },
      putImpl,
    });

    expect(putImpl).not.toHaveBeenCalled();
    expect(result).toEqual({
      stored: false,
      key: null,
      uri: "local-dev://Grp_Bills_May_2026.xlsx",
    });
  });

  it("throws in production when BLOB_READ_WRITE_TOKEN is missing", async () => {
    await expect(
      storeUploadedWorkbook({
        fileBytes,
        fileName: "GrpBills.xlsx",
        entityCode: "IND",
        snapshotId: "snapshot-123",
        fileSha256,
        env: { NODE_ENV: "production" },
        putImpl: vi.fn(),
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

  it("puts configured uploads to Vercel Blob and returns the blob URL", async () => {
    const blobUrl =
      "https://abc123.public.blob.vercel-storage.com/workbooks/IND/snapshot-123/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-GrpBills.xlsx";
    const putImpl = vi.fn(async () => ({ url: blobUrl, downloadUrl: blobUrl, pathname: "", contentType: "", contentDisposition: "" }));

    const result = await storeUploadedWorkbook({
      fileBytes,
      fileName: "GrpBills.xlsx",
      entityCode: "IND",
      snapshotId: "snapshot-123",
      fileSha256,
      env: {
        NODE_ENV: "production",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
      },
      putImpl,
    });

    const expectedKey =
      "workbooks/IND/snapshot-123/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-GrpBills.xlsx";

    expect(result).toEqual({
      stored: true,
      key: expectedKey,
      uri: blobUrl,
    });

    expect(putImpl).toHaveBeenCalledOnce();
    expect(putImpl).toHaveBeenCalledWith(expectedKey, fileBytes, {
      access: "private",
      token: "vercel_blob_rw_test_token",
      addRandomSuffix: false,
    });
  });

  it("wraps Vercel Blob errors as WorkbookStorageUploadError", async () => {
    const putImpl = vi.fn(async () => {
      throw new Error("Blob store unavailable");
    });

    await expect(
      storeUploadedWorkbook({
        fileBytes,
        fileName: "GrpBills.xlsx",
        entityCode: "IND",
        snapshotId: "snapshot-123",
        fileSha256,
        env: {
          NODE_ENV: "production",
          BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
        },
        putImpl,
      }),
    ).rejects.toBeInstanceOf(WorkbookStorageUploadError);
  });
});
