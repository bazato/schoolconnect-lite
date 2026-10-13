// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ requestOtp:vi.fn(),verifyOtp:vi.fn(),setupPasscode:vi.fn(),loginPasscode:vi.fn() }));
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(),...api }));
import { SignIn } from './App';
let host: HTMLDivElement; let root: Root; const signedIn=vi.fn();
beforeEach(async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); Object.values(api).forEach((fn) => fn.mockReset()); signedIn.mockReset();
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  await act(async () => root.render(<SignIn onSignedIn={signedIn} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function click(text:string) { await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent===text)!.click(); }); }
async function input(label:string,value:string) {
  const field=[...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value); field.dispatchEvent(new Event('input',{bubbles:true})); });
}
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); }); }
describe('web first activation and passcode sign-in', () => {
  it('shows passcode-only login by default and never requests OTP on normal sign-in', async () => {
    expect(host.textContent).not.toContain('Invitation code');
    await input('Mobile number','+919876543210'); await input('4-digit passcode','0123');
    api.loginPasscode.mockResolvedValue({accessToken:'web-session'});
    await submit(); expect(api.loginPasscode).toHaveBeenCalledWith('+919876543210','0123'); expect(api.requestOtp).not.toHaveBeenCalled(); expect(signedIn).toHaveBeenCalledOnce();
  });
  it('verifies OTP first, then requires matching passcodes before creating a session', async () => {
    await click('First login / set up passcode');
    await input('Mobile number','+919876543210'); await input('Invitation code','INVITE');
    api.requestOtp.mockResolvedValue({challengeId:'challenge',developmentCode:'123456'}); await submit();
    expect(api.requestOtp).toHaveBeenCalledWith('+919876543210','INVITE','ACTIVATE');
    api.verifyOtp.mockResolvedValue({setupToken:'grant'}); await submit();
    expect(api.verifyOtp).toHaveBeenCalledWith('challenge','123456'); expect(signedIn).not.toHaveBeenCalled();
    await input('New 4-digit passcode','0123'); await input('Confirm passcode','0124'); await submit();
    expect(host.textContent).toContain('passcodes do not match'); expect(api.setupPasscode).not.toHaveBeenCalled();
    await input('Confirm passcode','0123'); api.setupPasscode.mockResolvedValue({accessToken:'web-session'}); await submit();
    expect(api.setupPasscode).toHaveBeenCalledWith('grant','0123'); expect(signedIn).toHaveBeenCalledOnce();
  });
  it('uses a separate recovery purpose without asking for an invitation', async () => {
    await click('Forgot passcode?'); expect(host.textContent).not.toContain('Invitation code');
    await input('Mobile number','+919876543210'); api.requestOtp.mockResolvedValue({challengeId:'reset'}); await submit();
    expect(api.requestOtp).toHaveBeenCalledWith('+919876543210','','RESET');
  });
});
