// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {MobileSession} from './api';
const api=vi.hoisted(()=>({loginPasscode:vi.fn(),requestOtp:vi.fn(),saveSession:vi.fn(),setupPasscode:vi.fn(),verifyOtp:vi.fn(),mobileApi:{context:vi.fn(),switchRole:vi.fn(),logout:vi.fn()}}));
vi.mock('./api',()=>({...api,demoMode:false}));
import {useMobileSignIn} from './useMobileSignIn';
const parent={id:'parent',role:'PARENT' as const,schoolId:'school-a'},teacher={id:'teacher',role:'TEACHER' as const,schoolId:'school-a'};
const base:MobileSession={accessToken:'verified',refreshToken:'refresh',expiresInSeconds:600,user:{id:'user',displayName:'User'},memberships:[parent],activeMembershipId:'parent'};
let auth:ReturnType<typeof useMobileSignIn>,root:Root,host:HTMLDivElement;const signedIn=vi.fn();
function Harness(){auth=useMobileSignIn(signedIn);return <span>{auth.verifiedSession ? 'verified-workspaces' : auth.phase}</span>;}
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});[...Object.values(api).filter((value)=>typeof value==='function'),...Object.values(api.mobileApi)].forEach((method)=>method.mockReset());signedIn.mockReset();
  host=document.createElement('div');root=createRoot(host);await act(async()=>root.render(<Harness/>));
});
afterEach(async()=>{await act(async()=>root.unmount());});
const signIn=async()=>{await act(async()=>{auth.setPhone('+919876543210');auth.setPasscode('0123');});await act(async()=>auth.submit());};
describe('mobile automatic role-aware sign-in',()=>{
  it('removes the fixed role picker from the actual mobile login screen',()=>{
    const source=readFileSync(resolve('App.tsx'),'utf8');
    const login=source.slice(source.indexOf('function LoginScreen('),source.indexOf('function OfflineBanner('));
    expect(login).not.toContain('LoginRoleSelector');expect(login).not.toContain('Sign in as');expect(login).not.toContain('loginRole');expect(login).toContain('useMobileSignIn');expect(login).toContain('if(verifiedSession)');
    const profile=source.slice(source.indexOf('function ProfileScreen('),source.indexOf('function ProfileScreen(')+5000);
    expect(profile).not.toContain('availableRoles.map');expect(profile).toContain('Change workspace');
  });
  it.each(['PARENT','TEACHER','SCHOOL_ADMIN','PLATFORM_OWNER'] as const)('opens a single verified %s account automatically without asking for a role',async(role)=>{
    const session={...base,memberships:[{...parent,role}]};api.loginPasscode.mockResolvedValue(session);await signIn();
    expect(api.loginPasscode).toHaveBeenCalledExactlyOnceWith('+919876543210','0123');expect(signedIn).toHaveBeenCalledWith(role,session);expect(api.saveSession).toHaveBeenCalledWith(session);expect(auth.verifiedSession).toBeNull();
  });
  it('asks only verified multi-role numbers to choose after authentication, without persisting a default',async()=>{
    const session={...base,memberships:[parent,teacher]};api.loginPasscode.mockResolvedValue(session);api.mobileApi.context.mockResolvedValue({principal:{membershipId:'parent'},school:{id:'school-a',displayName:'First School'},memberships:[parent,teacher]});await signIn();
    expect(auth.verifiedSession?.memberships).toHaveLength(2);expect(auth.verifiedSession?.memberships[0]?.schoolName).toBe('First School');expect(api.saveSession).not.toHaveBeenCalled();expect(signedIn).not.toHaveBeenCalled();
    api.mobileApi.switchRole.mockResolvedValue({accessToken:'teacher-token',expiresInSeconds:600,activeMembership:teacher});await act(async()=>auth.chooseWorkspace('teacher'));
    expect(api.mobileApi.switchRole).toHaveBeenCalledWith(expect.objectContaining({accessToken:'verified'}),'teacher');expect(signedIn).toHaveBeenCalledWith('TEACHER',expect.objectContaining({activeMembershipId:'teacher',accessToken:'teacher-token'}));
  });
  it('does not grant an unassigned membership or continue after a denied server switch',async()=>{
    api.loginPasscode.mockResolvedValue({...base,memberships:[parent,teacher]});api.mobileApi.context.mockResolvedValue({principal:{},school:null,memberships:[parent,teacher]});await signIn();
    await act(async()=>auth.chooseWorkspace('owner'));expect(api.mobileApi.switchRole).not.toHaveBeenCalled();expect(signedIn).not.toHaveBeenCalled();
    api.mobileApi.switchRole.mockRejectedValue(Error('RESOURCE_ACCESS_DENIED'));await act(async()=>auth.chooseWorkspace('teacher'));expect(signedIn).not.toHaveBeenCalled();expect(api.saveSession).not.toHaveBeenCalled();expect(auth.serverError).toBe('RESOURCE_ACCESS_DENIED');
  });
  it('keeps same-role memberships for two schools distinct',async()=>{
    const second={...parent,id:'parent-b',schoolId:'school-b'};api.loginPasscode.mockResolvedValue({...base,memberships:[parent,second]});api.mobileApi.context.mockResolvedValue({principal:{},school:null,memberships:[parent,second]});await signIn();
    api.mobileApi.switchRole.mockResolvedValue({accessToken:'second-school',expiresInSeconds:600,activeMembership:second});await act(async()=>auth.chooseWorkspace('parent-b'));
    expect(signedIn).toHaveBeenCalledWith('PARENT',expect.objectContaining({activeMembershipId:'parent-b',accessToken:'second-school'}));
  });
  it('does not show any workspace on failed credentials',async()=>{
    api.loginPasscode.mockRejectedValue(Error('PHONE_OR_PASSCODE_INVALID'));await signIn();expect(auth.verifiedSession).toBeNull();expect(signedIn).not.toHaveBeenCalled();expect(api.saveSession).not.toHaveBeenCalled();
  });
  it('keeps first activation and passcode setup role-free',async()=>{
    await act(async()=>{auth.changeMode('activate');auth.setPhone('+919876543210');auth.setInvitation('INVITE');});api.requestOtp.mockResolvedValue({challengeId:'challenge'});await act(async()=>auth.submit());
    expect(api.requestOtp).toHaveBeenCalledWith('+919876543210','INVITE','ACTIVATE');expect(auth.phase).toBe('otp');expect(auth.verifiedSession).toBeNull();
    api.verifyOtp.mockResolvedValue({setupToken:'grant'});await act(async()=>auth.setOtp('123456'));await act(async()=>auth.submit());
    await act(async()=>{auth.setPasscode('0123');auth.setConfirmation('0124');});await act(async()=>auth.submit());expect(api.setupPasscode).not.toHaveBeenCalled();
    await act(async()=>auth.setConfirmation('0123'));api.setupPasscode.mockResolvedValue(base);await act(async()=>auth.submit());expect(api.setupPasscode).toHaveBeenCalledWith('grant','0123');expect(signedIn).toHaveBeenCalledWith('PARENT',base);
  });
  it('signs out a verified but unselected account before returning to the login form',async()=>{
    api.loginPasscode.mockResolvedValue({...base,memberships:[parent,teacher]});api.mobileApi.context.mockResolvedValue({principal:{},school:null,memberships:[parent,teacher]});await signIn();await act(async()=>auth.cancelWorkspace());expect(api.mobileApi.logout).toHaveBeenCalledOnce();expect(auth.verifiedSession).toBeNull();expect(auth.passcode).toBe('');expect(signedIn).not.toHaveBeenCalled();
  });
});
