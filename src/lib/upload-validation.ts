export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_EXTS = [".xlsx", ".xls", ".csv"] as const;
export const ALLOWED_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/octet-stream",
] as const;

const allowedExts = new Set<string>(ALLOWED_EXTS);
const allowedMimes = new Set<string>(ALLOWED_MIMES);

export type UploadValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "TOO_LARGE" | "BAD_EXTENSION" | "BAD_MIME";
      message: string;
    };

type UploadValidationInput = {
  filename: string;
  size: number;
  mime: string | null | undefined;
};

function extensionFor(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

export function validateUpload({
  filename,
  size,
  mime,
}: UploadValidationInput): UploadValidationResult {
  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "TOO_LARGE",
      message: "Upload must be 25 MB or smaller.",
    };
  }

  if (!allowedExts.has(extensionFor(filename))) {
    return {
      ok: false,
      code: "BAD_EXTENSION",
      message: "Upload must be an .xlsx, .xls, or .csv file.",
    };
  }

  if (!allowedMimes.has((mime ?? "").toLowerCase())) {
    return {
      ok: false,
      code: "BAD_MIME",
      message: "Upload MIME type is not allowed.",
    };
  }

  return { ok: true };
}
