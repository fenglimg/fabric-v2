import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

import { FabricError } from "@fenglimg/fabric-shared/errors";

export type FabricHttpApp = ReturnType<typeof createMcpExpressApp>;

type JsonResponse = {
  status: (code: number) => JsonResponse;
  json: (payload: unknown) => void;
};

type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type KnownApiError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

export function sendError(
  res: JsonResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const payload: ApiErrorBody = {
    error: {
      code,
      message,
    },
  };

  if (details !== undefined) {
    payload.error.details = details;
  }

  res.status(status).json(payload);
}

export function sendValidationError(
  res: JsonResponse,
  message: string,
  details: unknown,
): void {
  sendError(res, 400, "BAD_REQUEST", message, details);
}

export function sendUnknownError(res: JsonResponse, error: unknown): void {
  const normalized = normalizeApiError(error);
  sendError(res, normalized.status, normalized.code, normalized.message, normalized.details);
}

function normalizeApiError(error: unknown): KnownApiError {
  if (error instanceof FabricError) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      code: "INTERNAL_ERROR",
      message: error.message,
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: `Unexpected error: ${String(error)}`,
  };
}
