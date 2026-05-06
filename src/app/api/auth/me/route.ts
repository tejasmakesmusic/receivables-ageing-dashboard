import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getCurrentUser,
  asAuthenticatedUserResponse,
} from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { role_enum } from "@/generated/prisma/enums";

const meResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.nativeEnum(role_enum),
    entityIdScope: z.string().uuid().nullable(),
    isActive: z.boolean(),
    lastLoginAt: z.string().nullable(),
  }),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const payload: MeResponse = {
      user: asAuthenticatedUserResponse(user),
    };

    return NextResponse.json(meResponseSchema.parse(payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}
