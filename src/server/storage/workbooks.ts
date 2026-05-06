import { createHash, createHmac } from "node:crypto";

type EntityCode = "IND" | "UAE";
type RuntimeEnv = Record<string, string | undefined>;
type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "text">>;

interface WorkbookObjectKeyInput {
  entityCode: EntityCode;
  snapshotId: string;
  fileSha256: string;
  fileName: string;
}

interface StoreUploadedWorkbookInput extends WorkbookObjectKeyInput {
  fileBytes: Uint8Array;
  env?: RuntimeEnv;
  fetchImpl?: FetchLike;
  now?: Date;
}

interface StorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string | null;
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

function trim(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

function sha256Hex(value: string | Uint8Array | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function dateStamp(date: Date): string {
  return formatAmzDate(date).slice(0, 8);
}

function getStorageConfig(env: RuntimeEnv): StorageConfig | null {
  const bucket = trim(env.S3_BUCKET);
  const region = trim(env.S3_REGION);
  const accessKeyId = trim(env.S3_ACCESS_KEY_ID);
  const secretAccessKey = trim(env.S3_SECRET_ACCESS_KEY);
  const endpoint = trim(env.S3_ENDPOINT);
  const hasAnyStorageSetting = [
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint,
  ].some(Boolean);

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    if (env.NODE_ENV === "production" || hasAnyStorageSetting) {
      throw new WorkbookStorageConfigError(
        "Object storage requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY",
      );
    }

    return null;
  }

  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint,
  };
}

function encodeObjectPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function storageUrl(config: StorageConfig, key: string): string {
  const encodedKey = encodeObjectPath(key);
  if (config.endpoint) {
    const endpoint = config.endpoint.replace(/\/+$/, "");
    return `${endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey}`;
  }

  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodedKey}`;
}

function signHeaders(params: {
  config: StorageConfig;
  url: URL;
  bodyHash: string;
  now: Date;
}): Record<string, string> {
  const amzDate = formatAmzDate(params.now);
  const day = dateStamp(params.now);
  const credentialScope = `${day}/${params.config.region}/s3/aws4_request`;
  const headers = {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    host: params.url.host,
    "x-amz-content-sha256": params.bodyHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key as keyof typeof headers]}\n`)
    .join("");
  const canonicalRequest = [
    "PUT",
    params.url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    params.bodyHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${params.config.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, params.config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${params.config.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function buildWorkbookObjectKey(input: WorkbookObjectKeyInput): string {
  return `workbooks/${input.entityCode}/${input.snapshotId}/${input.fileSha256}-${sanitizeFileName(input.fileName)}`;
}

export async function storeUploadedWorkbook(
  input: StoreUploadedWorkbookInput,
): Promise<StoredWorkbook> {
  const env = input.env ?? process.env;
  const config = getStorageConfig(env);
  const fileName = sanitizeFileName(input.fileName);

  if (!config) {
    return {
      stored: false,
      key: null,
      uri: `local-dev://${fileName}`,
    };
  }

  const key = buildWorkbookObjectKey(input);
  const url = new URL(storageUrl(config, key));
  const body = Buffer.from(input.fileBytes);
  const bodyHash = sha256Hex(body);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(url.toString(), {
    method: "PUT",
    body,
    headers: signHeaders({
      config,
      url,
      bodyHash,
      now: input.now ?? new Date(),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new WorkbookStorageUploadError(
      `Workbook storage upload failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  return {
    stored: true,
    key,
    uri: `s3://${config.bucket}/${key}`,
  };
}
