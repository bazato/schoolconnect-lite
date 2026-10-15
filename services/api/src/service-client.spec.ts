import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ServiceClient } from './app.module';
afterEach(() => vi.unstubAllGlobals());
describe('file capability errors at the gateway', () => {
  it('preserves a disabled-attachments 503 instead of hiding it as a bad gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code:'FILE_ATTACHMENTS_DISABLED' }), { status:503, headers:{ 'content-type':'application/json' } })));
    try { await new ServiceClient().request('files', '/internal/v1/uploads', { method:'POST' }); throw new Error('expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toEqual({ code:'FILE_ATTACHMENTS_DISABLED' });
    }
  });
});
