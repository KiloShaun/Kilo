import { SetMetadata } from '@nestjs/common';

export const AUDITED_ACTION_KEY = 'audited_action';

/**
 * Marks a handler as performing a sensitive mutation that must be recorded in the
 * AuditLog table. The AuditLogInterceptor reads this metadata; see docs/security.md.
 */
export const Audited = (action: string) => SetMetadata(AUDITED_ACTION_KEY, action);
