import { HttpStatus } from '@nestjs/common';

/**
 * Base class for business-rule errors that need a stable machine-readable `code`
 * (e.g. "CHILD_ALREADY_CHECKED_IN") distinct from the generic HTTP status text.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundDomainError extends DomainError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found.`, HttpStatus.NOT_FOUND);
  }
}

export class ConflictDomainError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message, HttpStatus.CONFLICT);
  }
}
