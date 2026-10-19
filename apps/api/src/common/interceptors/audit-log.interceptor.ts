import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDITED_ACTION_KEY } from '../decorators/audited.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';
import { RequestWithCorrelationId } from '../middleware/correlation-id.middleware';

/**
 * Records every handler annotated with @Audited(...) into the append-only AuditLog table.
 * New mutating endpoints get audit coverage by adding the decorator, not by remembering to
 * call a logging function by hand — see docs/security.md.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.get<string>(AUDITED_ACTION_KEY, context.getHandler());
    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithCorrelationId>();
    const user = request.user as AuthenticatedUser | undefined;
    const requestBody = request.body;

    return next.handle().pipe(
      tap((result: unknown) => {
        const resourceId =
          result && typeof result === 'object' && 'id' in result
            ? String((result as { id: unknown }).id)
            : (request.params?.id ?? null);

        void this.auditService.record({
          actorUserId: user?.id ?? null,
          action,
          resourceType: action.split('_')[0] ?? 'UNKNOWN',
          resourceId,
          after: requestBody,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
      }),
    );
  }
}
