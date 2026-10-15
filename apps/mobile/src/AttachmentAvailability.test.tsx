// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  View: ({ children }: any) => <div>{children}</div>, Text: ({ children }: any) => <span>{children}</span>,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('./attachmentUpload', () => ({ attachmentsDisabledMessage: 'Document uploads are currently disabled on the server while secure file scanning is being completed.' }));
import { AttachmentAvailability } from './AttachmentAvailability';
describe('attachment availability UI', () => {
  it.each(['checking', 'disabled', 'error'] as const)('shows %s without offering a misleading file picker', async state => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); const root = createRoot(container); const retry = vi.fn();
    try {
      await act(async () => root.render(<AttachmentAvailability state={state} onRetry={retry} />));
      expect(container.textContent).not.toContain('Add PDF or image');
      if (state === 'disabled') expect(container.textContent).toContain('secure file scanning');
      if (state === 'checking') expect(container.querySelector('button')).toBeNull();
      else { await act(async () => container.querySelector('button')!.click()); expect(retry).toHaveBeenCalledOnce(); }
    } finally { await act(async () => root.unmount()); }
  });
});
