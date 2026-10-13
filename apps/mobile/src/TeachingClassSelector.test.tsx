// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTeachingAssignment } from './api';

vi.mock('react-native', () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  ScrollView: ({ children }: any) => <div>{children}</div>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityState }: any) => <button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} disabled={disabled} onClick={onPress}>{typeof children === 'function' ? children({ pressed: false }) : children}</button>,
  Modal: ({ children, visible }: any) => visible ? <div role="dialog">{children}</div> : null,
  ActivityIndicator: () => <span>Loading</span>,
  KeyboardAvoidingView: ({ children }: any) => <div>{children}</div>,
  Linking: {}, Platform: { OS: 'web' }, Switch: () => null, TextInput: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('lucide-react-native', () => ({ Check: () => null, ChevronDown: () => null }));

import { TeachingClassSelector } from './TeachingClassSelector';

const scope = [
  { assignmentId: 'assignment-a', classId: 'class-a', className: 'Class A', subjectName: 'Math' },
  { assignmentId: 'assignment-b', classId: 'class-b', className: 'Class B', subjectName: 'Science' },
] as ApiTeachingAssignment[];
let container: HTMLDivElement;
let root: Root;
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => { button!.click(); });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('mobile teaching class selector', () => {
  it('switches to the second assignment and closes the selector', async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(<TeachingClassSelector scope={scope} selected={scope[0]} schoolName="Actual School" onSelect={onSelect} />));
    await click('Select teaching class and subject'); await click('Class B, Science');
    expect(onSelect).toHaveBeenCalledWith('assignment-b');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Actual School');
  });
  it('requires attendance confirmation and lets the teacher cancel without switching', async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(<TeachingClassSelector scope={scope} selected={scope[0]} schoolName="School" onSelect={onSelect} confirmSelection="Unsaved marks will be discarded" />));
    await click('Select teaching class and subject'); await click('Class B, Science');
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Unsaved marks will be discarded');
    await click('Keep current class'); expect(onSelect).not.toHaveBeenCalled();
    await click('Class B, Science'); await click('Switch class');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('assignment-b');
  });
  it('does not switch during publishing, upload or attendance submission', async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(<TeachingClassSelector scope={scope} selected={scope[0]} schoolName="School" onSelect={onSelect} disabled />));
    await click('Select teaching class and subject');
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(onSelect).not.toHaveBeenCalled();
  });
  it('keeps the current action open if saving the previous class draft fails', async () => {
    const onSelect = vi.fn().mockRejectedValue(new Error('Draft could not be saved'));
    await act(async () => root.render(<TeachingClassSelector scope={scope} selected={scope[0]} schoolName="School" onSelect={onSelect} />));
    await click('Select teaching class and subject'); await click('Class B, Science');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('Draft could not be saved');
  });
});
