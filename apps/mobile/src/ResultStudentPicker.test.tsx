// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  View: ({ children }: any) => <div>{children}</div>, Text: ({ children }: any) => <span>{children}</span>,
  Pressable: ({ children, accessibilityRole, accessibilityLabel, accessibilityState, disabled, onPress }: any) => <button role={accessibilityRole} aria-label={accessibilityLabel} aria-checked={accessibilityState.checked} disabled={disabled} onClick={onPress}>{children}</button>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('lucide-react-native', () => ({ Check: () => null }));
import { ResultStudentPicker } from './ResultStudentPicker';
describe('result student identity', () => {
  async function render(students: Array<{ id: string; displayName: string; admissionNumber: string }>, disabled = false) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); const root = createRoot(container); const onSelect = vi.fn();
    await act(async () => root.render(<ResultStudentPicker students={students} selectedId={students[0]?.id ?? ''} disabled={disabled} onSelect={onSelect} />));
    return { container, onSelect, close: async () => { await act(async () => root.unmount()); } };
  }
  it('renders a multiword full name as ONE selectable student', async () => {
    const view = await render([{ id: 'one', displayName: 'Alex Morgan Williams', admissionNumber: 'A-001' }]);
    try {
      expect(view.container.querySelectorAll('[role="radio"]')).toHaveLength(1);
      expect(view.container.textContent).toContain('Alex Morgan Williams'); expect(view.container.textContent).toContain('Admission no. A-001');
      await act(async () => view.container.querySelector('button')!.click()); expect(view.onSelect).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });
  it('keeps distinct IDs/admissions separate rather than combining names or siblings', async () => {
    const view = await render([{ id: 'one', displayName: 'Alex', admissionNumber: 'A-001' }, { id: 'two', displayName: 'Morgan', admissionNumber: 'B-002' }]);
    try {
      const rows = view.container.querySelectorAll('button'); expect(rows).toHaveLength(2);
      expect(rows[0]!.textContent).toContain('A-001'); expect(rows[1]!.textContent).toContain('B-002');
      await act(async () => rows[1]!.click()); expect(view.onSelect).toHaveBeenCalledExactlyOnceWith('two');
    } finally { await view.close(); }
  });
  it('prevents changing the file recipient during upload or publishing', async () => {
    const view = await render([{ id: 'one', displayName: 'Alex', admissionNumber: 'A' }, { id: 'two', displayName: 'Morgan', admissionNumber: 'B' }], true);
    try { await act(async () => view.container.querySelectorAll('button')[1]!.click()); expect(view.onSelect).not.toHaveBeenCalled(); }
    finally { await view.close(); }
  });
});
