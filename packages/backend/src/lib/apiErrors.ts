import type { FastifyReply } from "fastify";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export function sendApiError(
  reply: FastifyReply,
  input: {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }
) {
  const { status, code, message, details } = input;
  return reply.status(status).send({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

