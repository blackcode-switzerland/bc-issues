// Canonical error model for API routes.
//
// Throw an ApiError from anywhere inside an apiHandler-wrapped route. The
// wrapper (lib/api/handler.ts → buildResponseBody) flattens it into a JSON
// response of shape:
//   { error: string, code: string, suggestion?: string, details?: unknown }
// where `error` is the human-readable message, `code` is the machine-readable
// identifier, `suggestion` is set when `details` is a string (the CLI hint),
// and `details` carries structured context otherwise.
//
// 4xx errors are not written to error_events (they are normal client errors).
// 5xx errors and any non-ApiError throwable are recorded.

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const Errors = {
  unauthorized: (message = 'Authentication required') => new ApiError(401, 'unauthorized', message),

  forbidden: (message = 'You do not have permission to perform this action') =>
    new ApiError(403, 'forbidden', message),

  notFound: (entity: string) =>
    new ApiError(404, `${entity}_not_found`, `${entity} not found`),

  badRequest: (code: string, message: string, details?: unknown) =>
    new ApiError(400, code, message, details),

  conflict: (code: string, message: string, details?: unknown) =>
    new ApiError(409, code, message, details),

  unprocessable: (code: string, message: string, details?: unknown) =>
    new ApiError(422, code, message, details),

  tooManyRequests: (message = 'Too many requests') =>
    new ApiError(429, 'too_many_requests', message),

  internal: (message = 'Internal server error', details?: unknown) =>
    new ApiError(500, 'internal_error', message, details),
}
