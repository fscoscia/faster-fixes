/**
 * ClickUp answered a request with something we cannot use. Infrastructure, like
 * `SlackRequestError`: a plain `Error` subclass, never a `DomainError`, so a
 * durable function keeps retrying it (ADR 0012).
 */
export class ClickUpRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClickUpRequestError";
  }
}
