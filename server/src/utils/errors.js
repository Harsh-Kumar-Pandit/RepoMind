/**
 * HTTP-aware application error used by routes and services.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = null, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isTransientHttpStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}
