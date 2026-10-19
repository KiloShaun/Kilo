import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelationId, res: Response, next: NextFunction) {
    const incoming = req.header(CORRELATION_ID_HEADER);
    req.correlationId = incoming && incoming.length > 0 ? incoming : uuidv4();
    res.setHeader(CORRELATION_ID_HEADER, req.correlationId);
    next();
  }
}
