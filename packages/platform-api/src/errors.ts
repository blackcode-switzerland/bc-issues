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

  // `suggestion` and `code` are optional so existing callers are unchanged. Pass
  // them when a 403 is RECOVERABLE — "ask an owner to grant you the app" is
  // actionable, a bare "forbidden" is a dead end, and the CLI prints the
  // suggestion as its `hint:` line.
  forbidden: (
    message = 'You do not have permission to perform this action',
    suggestion?: string,
    code = 'forbidden'
  ) => new ApiError(403, code, message, suggestion),

  // One-arg form unchanged: `notFound('issue')` → 404 issue_not_found.
  //
  // The three-arg form exists because a 404 is often the most recoverable failure
  // an agent hits and was the only class that could not carry a `suggestion` —
  // "run `bk search <query>` to find the current URN" turns a dead end into a
  // next step. Same reasoning that added one to `forbidden` in Phase 4. When
  // `message` is given, `entity` is used verbatim as the code rather than having
  // `_not_found` appended, so a caller can name the exact condition.
  notFound: (entity: string, message?: string, suggestion?: string) =>
    message === undefined
      ? new ApiError(404, `${entity}_not_found`, `${entity} not found`)
      : new ApiError(404, entity, message, suggestion),

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
