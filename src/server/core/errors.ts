import { NextResponse } from "next/server";
import { z } from "zod";

export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  status: z.number(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export class HttpError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = code;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string) {
    super("unauthorized", 401, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super("forbidden", 403, message);
  }
}

export function toErrorResponse(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof HttpError) {
    return NextResponse.json(
      {
        code: error.code,
        message: error.message,
        status: error.status,
      },
      { status: error.status },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json(
      {
        code: "internal_server_error",
        message: error.message,
        status: 500,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      code: "internal_server_error",
      message: "Unexpected authentication failure",
      status: 500,
    },
    { status: 500 },
  );
}
