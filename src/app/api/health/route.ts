import { NextResponse } from "next/server";
import { getDbHealthStatus } from "@/server/db/smoke";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDbHealthStatus();

  return NextResponse.json({
    status: db.status === "ok" ? "ok" : "error",
    db: db.status,
    ...(db.detail ? { dbDetail: db.detail } : {}),
    service: "receivables-web",
    at: new Date().toISOString(),
  });
}
