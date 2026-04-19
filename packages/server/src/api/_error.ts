import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

import { AgentsMetaFileMissingError, AgentsMetaInvalidError } from "../meta-reader.js";

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
  if (
    error instanceof Error &&
    "status" in error &&
    "code" in error &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return {
      status: (error as { status: number }).status,
      code: (error as { code: string }).code,
      message: error.message,
    };
  }

  if (error instanceof AgentsMetaFileMissingError) {
    return {
      status: 404,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof AgentsMetaInvalidError) {
    return {
      status: 500,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    if (error.message.startsWith("Path escapes project root:")) {
      return {
        status: 403,
        code: "PATH_OUTSIDE_PROJECT_ROOT",
        message: error.message,
      };
    }

    if (error.message.startsWith("Cannot find human lock entry:")) {
      return {
        status: 404,
        code: "HUMAN_LOCK_ENTRY_NOT_FOUND",
        message: error.message,
      };
    }

    if (error.message.startsWith("Cannot find ledger entry:")) {
      return {
        status: 404,
        code: "LEDGER_ENTRY_NOT_FOUND",
        message: error.message,
      };
    }

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
