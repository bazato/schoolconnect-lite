// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({readSession:vi.fn(),saveSession:vi.fn(),apiRequest:vi.fn(),loginPasscode:vi.fn()}));
vi.mock('./api',async(original)=>({...await original<typeof import('./api')>(),...mocks}));
import {App} from './App';
const owner={id:'owner-member',role:'PLATFORM_OWNER',schoolId:null};
const administrator={id:'admin-member',role:'SCHOOL_ADMIN',schoolId:'school-2',schoolName:'Second School'};
const session={accessToken:'token',refreshToken:'refresh',deviceId:'web',expiresInSeconds:600,activeMembershipId:owner.id,user:{id:'user',displayName:'Owner'},memberships:[owner,administrator]};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.values(mocks).forEach((method)=>method.mockReset());mocks.readSession.mockReturnValue(session);
  mocks.apiRequest.mockImplementation(async(path:string)=>{
    if(path==='/me/context')return {principal:{userId:'user',membershipId:owner.id,role:'PLATFORM_OWNER',displayName:'Owner',schoolId:null},school:null,memberships:session.memberships};
    if(path==='/admin/schools')return [{id:'school-1',displayName:'First School',schoolCode:'SCH1',status:'ACTIVE',timezone:'UTC'}];
    if(path==='/admin/reports/platform-summary')return {schools:[{id:'school-1',displayName:'First School',schoolCode:'SCH1',status:'ACTIVE',timezone:'UTC'}]};
    if(path==='/auth/switch-role')return {accessToken:'admin-token',activeMembership:administrator};
    if(path.includes('/summary'))return {studentCount:0,teacherCount:0};return [];
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function click(text:string){await act(async()=>{[...host.querySelectorAll('button')].find((button)=>button.textContent?.includes(text))!.click();});}
describe('web workspaces without role/school dropdowns',()=>{
  it('uses verified workspace buttons and school directory cards, not selectors',async()=>{
    await act(async()=>root.render(<App/>));expect(host.querySelector('select[aria-label="Switch role"]')).toBeNull();expect(host.querySelector('select[aria-label="Select school to manage"]')).toBeNull();expect(host.textContent).toContain('School administrator · Second School');
    await click('Choose school');expect(host.textContent).toContain('First School');await click('Manage administrators');
    await click('School administrator · Second School');
    const switched=mocks.apiRequest.mock.calls.find(([path])=>path==='/auth/switch-role');expect(JSON.parse(switched![3].body)).toEqual({membershipId:'admin-member'});expect(switched![3].headers).toBeUndefined();
  });
  it('asks for a workspace only after a multi-role number has signed in',async()=>{
    mocks.readSession.mockReturnValue(null);mocks.loginPasscode.mockResolvedValue(session);
    await act(async()=>root.render(<App/>));expect(host.textContent).not.toContain('Choose your workspace');expect(host.querySelector('select')).toBeNull();
    await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    expect(host.textContent).toContain('Choose your workspace');expect(host.textContent).toContain('School administrator · Second School');expect(host.querySelector('select')).toBeNull();
  });
});
