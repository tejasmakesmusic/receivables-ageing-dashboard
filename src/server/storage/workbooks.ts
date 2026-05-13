import type { put as VercelBlobPut } from "@vercel/blob";

type EntityCode = "IND" | "UAE";
type RuntimeEnv = Record<string, string | undefined>;
type BlobPutFn = typeof VercelBlobPut;

interface WorkbookObjectKeyInput {
  entityCode: EntityCode;
  snapshotId: string;
  fileSha256: string;
  fileName: string;
}

interface StoreUploadedWorkbookInput extends WorkbookObjectKeyInput {
  fileBytes: Uint8Array;
  env?: RuntimeEnv;
  putImpl?: BlobPutFn;
}

export interface StoredWorkbook {
  stored: boolean;
  key: string | null;
  uri: string;
}

export class WorkbookStorageConfigError extends Error {
  readonly code = "object_storage_misconfigured";

  constructor(message: string) {
    super(message);
    this.name = "WorkbookStorageConfigError";
  }
}

export class WorkbookStorageUploadError extends Error {
  readonly code = "object_storage_upload_failed";

  constructor(message: string) {
    super(message);
    this.name = "WorkbookStorageUploadError";
  }
}

function sanitizeFileName(fileName: string): string {
  const basename = fileName.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const safe = basename
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+/, "")
    .slice(0, 160);

  return safe || "workbook.xlsx";
}

function getToken(env: RuntimeEnv): string | null {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    if (env.NODE_ENV === "production") {
      throw new WorkbookStorageConfigError(
        "Object storage requires BLOB_READ_WRITE_TOKEN to be set in production",
      );
    }
    return null;
  }
  return token;
}

export function buildWorkbookObjectKey(input: WorkbookObjectKeyInput): string {
  return `workbooks/${input.entityCode}/${input.snapshotId}/${input.fileSha256}-${sanitizeFileName(input.fileName)}`;
}

export async function storeUploadedWorkbook(
  input: StoreUploadedWorkbookInput,
): Promise<StoredWorkbook> {
  const env = input.env ?? process.env;
  const fileName = sanitizeFileName(input.fileName);
  const token = getToken(env);

  if (!token) {
    return {
      stored: false,
      key: null,
      uri: `local-dev://${fileName}`,
    };
  }

  const key = buildWorkbookObjectKey(input);

  let putImpl: BlobPutFn;
  if (input.putImpl) {
    putImpl = input.putImpl;
  } else {
    const mod = await import("@vercel/blob");
    putImpl = mod.put;
  }

  let blobUrl: string;
  try {
    const result = await putImpl(key, Buffer.from(input.fileBytes), {
      access: "private",
      token,
      addRandomSuffix: false,
    });
    blobUrl = result.url;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkbookStorageUploadError(
      `Workbook storage upload failed: ${message}`,
    );
  }

  return {
    stored: true,
    key,
    uri: blobUrl,
  };
}
