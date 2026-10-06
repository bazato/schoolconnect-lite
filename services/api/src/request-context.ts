import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type RequestContext = {
  correlationId: string;
  schoolId?: string;
  userId?: string;
  membershipId?: string;
  role?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const currentRequestContext = () => storage.getStore();

export function requestContextMiddleware(request: Request, response: Response, next: NextFunction) {
  const supplied = request.headers['x-correlation-id'];
  const correlationId = typeof supplied === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(supplied)
    ? supplied : randomUUID();
  response.setHeader('x-correlation-id', correlationId);
  storage.run({ correlationId }, next);
}
