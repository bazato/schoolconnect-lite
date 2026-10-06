import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ServiceClient } from './app.module';
import { currentRequestContext, requestContextMiddleware } from './request-context';

afterEach(() => vi.unstubAllGlobals());

describe('request correlation', () => {
  it('propagates a valid ID and server-resolved actor context to internal calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const setHeader = vi.fn();
    await new Promise<void>((resolve, reject) => {
      requestContextMiddleware(
        { headers: { 'x-correlation-id': 'school-trace-1' } } as unknown as Request,
        { setHeader } as unknown as Response,
        () => {
          void (async () => {
            const trace = currentRequestContext();
            expect(trace?.correlationId).toBe('school-trace-1');
            Object.assign(trace!, { schoolId: 'school-1', userId: 'teacher-1', membershipId: 'member-1', role: 'TEACHER' });
            await new ServiceClient().request('school', '/internal/v1/health');
          })().then(resolve, reject);
        },
      );
    });
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'school-trace-1');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-correlation-id': 'school-trace-1', 'x-schoolconnect-school-id': 'school-1',
      'x-schoolconnect-user-id': 'teacher-1', 'x-schoolconnect-membership-id': 'member-1',
    });
  });

  it('replaces an unsafe client-supplied ID', () => {
    const setHeader = vi.fn();
    requestContextMiddleware(
      { headers: { 'x-correlation-id': 'bad id with spaces' } } as unknown as Request,
      { setHeader } as unknown as Response,
      () => {
        expect(currentRequestContext()?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      },
    );
    expect(setHeader).toHaveBeenCalledOnce();
  });
});
