import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES, validateUpload } from "@/lib/upload-validation";

describe("upload validation", () => {
  it.each([
    [
      "xlsx",
      "receivables.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["xls", "receivables.xls", "application/vnd.ms-excel"],
    ["csv", "receivables.csv", "text/csv"],
  ])("accepts %s files with valid mime within size", (_type, filename, mime) => {
    expect(
      validateUpload({ filename, size: MAX_UPLOAD_BYTES, mime }),
    ).toEqual({ ok: true });
  });

  it("rejects oversize files", () => {
    expect(
      validateUpload({
        filename: "receivables.xlsx",
        size: MAX_UPLOAD_BYTES + 1,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({
      ok: false,
      code: "TOO_LARGE",
      message: "Upload must be 25 MB or smaller.",
    });
  });

  it("rejects bad extensions", () => {
    expect(
      validateUpload({
        filename: "receivables.pdf",
        size: 1024,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({
      ok: false,
      code: "BAD_EXTENSION",
      message: "Upload must be an .xlsx, .xls, or .csv file.",
    });
  });

  it("rejects bad mime types", () => {
    expect(
      validateUpload({
        filename: "receivables.csv",
        size: 1024,
        mime: "application/pdf",
      }),
    ).toEqual({
      ok: false,
      code: "BAD_MIME",
      message: "Upload MIME type is not allowed.",
    });
  });
});
