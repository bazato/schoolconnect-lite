// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
vi.mock('react-native',()=>({View:({children}:any)=><div>{children}</div>,Text:({children}:any)=><span>{children}</span>,Pressable:({children,accessibilityLabel,accessibilityState,disabled,onPress}:any)=><button role="radio" aria-label={accessibilityLabel} aria-checked={accessibilityState.checked} disabled={disabled} onClick={onPress}>{children}</button>}));
import {LoginRoleSelector} from './LoginRoleSelector';
describe('explicit login role choice',()=>{
  it('keeps teacher, parent and school-administrator choices distinct for one number',async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');const root=createRoot(host);const change=vi.fn();try{await act(async()=>root.render(<LoginRoleSelector value="PARENT" onChange={change}/>));expect(host.querySelectorAll('[role="radio"]')).toHaveLength(4);expect(host.querySelector('[aria-label="Parent"]')!.getAttribute('aria-checked')).toBe('true');await act(async()=>(host.querySelector('[aria-label="Teacher"]') as HTMLButtonElement).click());expect(change).toHaveBeenCalledExactlyOnceWith('TEACHER');}finally{await act(async()=>root.unmount());}});
  it('does not change role while login is submitting',async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');const root=createRoot(host);const change=vi.fn();try{await act(async()=>root.render(<LoginRoleSelector value="TEACHER" onChange={change} disabled/>));await act(async()=>(host.querySelector('[aria-label="Parent"]') as HTMLButtonElement).click());expect(change).not.toHaveBeenCalled();}finally{await act(async()=>root.unmount());}});
});
