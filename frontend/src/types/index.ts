/**
 * Shared TypeScript types. Populated as API endpoints land (M1+).
 * Long-term plan: generate from backend pydantic schemas via an OpenAPI codegen step.
 */

export type EntityCode = "IND" | "UAE";
export type AgeingBucket = "NOT_DUE" | "0_30" | "31_60" | "61_90" | "90_PLUS";
export type Role = "ANALYST" | "CFO" | "ADMIN" | "PENDING";
