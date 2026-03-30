import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const raw = req.headers['x-request-id'];
    const fromHeader = Array.isArray(raw) ? raw[0] : raw;
    req.requestId =
      typeof fromHeader === 'string' && fromHeader.length > 0 ? fromHeader : uuidv4();
    next();
  }
}
