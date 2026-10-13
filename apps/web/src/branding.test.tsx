// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

describe('Nexqon portal branding', () => {
  it('renders the new name and custom logo on sign-in', () => {
    localStorage.clear();
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('Nexqon');
    expect(markup).toContain('School App');
    expect(markup).toContain('/nexqon-icon.png');
    expect(markup).not.toContain('SchoolConnect');
  });
});
