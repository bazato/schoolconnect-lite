// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
import type {MobileSession} from './api';
vi.mock('react-native',()=>({View:({children}:any)=><div>{children}</div>,ScrollView:({children}:any)=><div>{children}</div>,Text:({children}:any)=><span>{children}</span>,Pressable:({children,disabled,onPress}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>,ActivityIndicator:()=>null,StyleSheet:{create:(styles:unknown)=>styles}}));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:({children}:any)=><div>{children}</div>}));
import {VerifiedWorkspacePicker} from './VerifiedWorkspacePicker';
const session={accessToken:'verified',memberships:[{id:'parent-a',role:'PARENT',schoolId:'a',schoolName:'First School'},{id:'parent-b',role:'PARENT',schoolId:'b',schoolName:'Second School'}]} as MobileSession;
describe('verified workspaces, not a public role selector',()=>{
  it('renders only memberships from the verified session and distinguishes two schools for the same role',async()=>{
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div'),root=createRoot(host),choose=vi.fn();
    try{
      await act(async()=>root.render(<VerifiedWorkspacePicker session={session} busy={false} error="" onChoose={choose} onCancel={()=>undefined}/>));
      expect(host.textContent).not.toContain('Teacher');expect(host.textContent).not.toContain('administrator');expect(host.textContent).not.toContain('owner');expect(host.textContent).toContain('First School');expect(host.textContent).toContain('Second School');expect(host.querySelectorAll('button')).toHaveLength(3);
      await act(async()=>[...host.querySelectorAll('button')].find((button)=>button.textContent?.includes('Second School'))!.click());expect(choose).toHaveBeenCalledExactlyOnceWith('parent-b');
    }finally{await act(async()=>root.unmount());}
  });
  it('blocks all selections and sign-out while a request is running',async()=>{
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div'),root=createRoot(host),choose=vi.fn(),cancel=vi.fn();
    try{await act(async()=>root.render(<VerifiedWorkspacePicker session={session} busy error="" onChoose={choose} onCancel={cancel}/>));await act(async()=>host.querySelectorAll('button').forEach((button)=>button.click()));expect(choose).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();}finally{await act(async()=>root.unmount());}
  });
});
