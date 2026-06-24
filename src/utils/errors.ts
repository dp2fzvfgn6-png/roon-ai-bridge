import { Response } from "express";

export type ErrorCode =
  | "ROON_NOT_CONNECTED"
  | "ROON_NOT_AUTHORIZED"
  | "TRANSPORT_NOT_READY"
  | "BROWSE_NOT_READY"
  | "INVALID_SEARCH_QUERY"
  | "SEARCH_NO_RESULTS"
  | "PLAYBACK_ACTION_NOT_FOUND"
  | "QUEUE_NOT_READY"
  | "INVALID_QUEUE_ACTION"
  | "INVALID_QUEUE_ITEM_ID"
  | "QUEUE_ACTION_NOT_FOUND"
  | "ZONE_NOT_FOUND"
  | "OUTPUT_NOT_FOUND"
  | "UNSUPPORTED_COMMAND"
  | "VOLUME_NOT_SUPPORTED"
  | "INVALID_VOLUME_MODE"
  | "INVALID_VOLUME_VALUE"
  | "NOT_IMPLEMENTED"
  | "INTERNAL_ERROR";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  ROON_NOT_CONNECTED: 503,
  ROON_NOT_AUTHORIZED: 401,
  TRANSPORT_NOT_READY: 503,
  BROWSE_NOT_READY: 503,
  INVALID_SEARCH_QUERY: 400,
  SEARCH_NO_RESULTS: 404,
  PLAYBACK_ACTION_NOT_FOUND: 422,
  QUEUE_NOT_READY: 503,
  INVALID_QUEUE_ACTION: 400,
  INVALID_QUEUE_ITEM_ID: 400,
  QUEUE_ACTION_NOT_FOUND: 422,
  ZONE_NOT_FOUND: 404,
  OUTPUT_NOT_FOUND: 404,
  UNSUPPORTED_COMMAND: 400,
  VOLUME_NOT_SUPPORTED: 400,
  INVALID_VOLUME_MODE: 400,
  INVALID_VOLUME_VALUE: 400,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500
};

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    status = DEFAULT_STATUS[code]
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function sendError(res: Response, error: ApiError): void {
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  });
}

export function notImplemented(feature: string): ApiError {
  return new ApiError("NOT_IMPLEMENTED", `${feature} is not implemented in v0.4`, {
    feature
  });
}
