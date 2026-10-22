import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RequestWithCorrelationId } from '../middleware/correlation-id.middleware';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithCorrelationId>();
    const { method, originalUrl, correlationId } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          this.logger.log(
            JSON.stringify({
              correlationId,
              method,
              path: originalUrl,
              statusCode: response.statusCode,
              durationMs: Date.now() - start,
            }),
          );
        },
        error: (err) => {
          this.logger.warn(
            JSON.stringify({
              correlationId,
              method,
              path: originalUrl,
              durationMs: Date.now() - start,
              error: err instanceof Error ? err.message : 'unknown error',
            }),
          );
        },
      }),
    );
  }
}
