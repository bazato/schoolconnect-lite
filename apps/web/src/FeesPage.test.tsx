// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeesPage } from './FeesPage';
import type { Recognition } from './fee-voice';
import * as workbook from './fees-workbook';
let host: HTMLDivElement, root: Root;
const api=vi.fn(), request=async<T,>(path:string,init?:RequestInit):Promise<T> => await api(path,init) as T;
const click=async(label:string) => { await act(async() => { const button=[...host.querySelectorAll('button')].find((item) => item.textContent===label);expect(button).toBeDefined();button!.click(); }); };
beforeEach(() => { Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);api.mockReset(); });
afterEach(async() => { await act(async() => root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals(); });
describe('school fee workspace', () => {
  it('has a download template and typed fallback without microphone support', async() => {
    await act(async() => root.render(<FeesPage request={request} />));
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/nexqon-fees-template.xlsx');
    expect(host.textContent).toContain('Voice input is not supported');
    expect([...host.querySelectorAll('button')].find((button) => button.textContent==='Use microphone')?.disabled).toBe(true);
  });
  it('requires transcript confirmation and never automatically submits speech', async() => {
    let instance: Recognition | null=null;
    const capture=(value:Recognition) => { instance=value; };
    class FakeRecognition implements Recognition { lang='';continuous=false;interimResults=false;onresult:Recognition['onresult']=null;onerror:Recognition['onerror']=null;onend:Recognition['onend']=null;constructor(){capture(this);}start(){}stop(){this.onend?.();}abort(){} }
    Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});Object.defineProperty(window,'SpeechRecognition',{value:FakeRecognition,configurable:true});
    await act(async() => root.render(<FeesPage request={request} />));
    await act(async() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());await click('Use microphone');
    await act(async() => { (instance as Recognition | null)?.onresult?.({results:[[{transcript:'fees collected this month'}]]});(instance as Recognition | null)?.onend?.(); });
    expect(api).not.toHaveBeenCalled();expect(host.querySelector<HTMLInputElement>('input[maxlength="300"]')!.value).toBe('fees collected this month');
    api.mockResolvedValue({query:{label:'October',metric:'COLLECTED'},studentCount:1,recordCount:1,currencies:[{currency:'INR',amount:'20.00'}],records:[],truncated:false});
    await act(async() => host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({question:'fees collected this month'});expect(host.textContent).toContain('20.00');
    Reflect.deleteProperty(window,'SpeechRecognition');Reflect.deleteProperty(window,'isSecureContext');
  });
  it('blocks invalid imports and saves only after explicit valid preview confirmation', async() => {
    vi.spyOn(workbook,'parseFeesWorkbook').mockResolvedValue({fees:[{admissionNumber:'001',feeReference:'OCT',academicYear:'2026',dueDate:'2026-10-01',amount:'100',currency:'INR',description:''}],collections:[]});
    api.mockResolvedValue({valid:false,revision:0,counts:{feesAdded:0,feesUpdated:0,feesUnchanged:0,collectionsAdded:0,collectionsUpdated:0,collectionsUnchanged:0},rows:[],issues:[{sheet:'Fees',row:2,message:'Unknown admission number'}]});
    await act(async() => root.render(<FeesPage request={request} />));
    const input=host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input,'files',{value:[new File(['dummy'],'fees.xlsx')]});
    await act(async() => input.dispatchEvent(new Event('change',{bubbles:true})));
    expect(api).toHaveBeenCalledOnce();expect(host.textContent).toContain('Nothing has been saved');expect([...host.querySelectorAll('button')].find((button) => button.textContent==='Confirm add / update')?.disabled).toBe(true);
  });
  it('does not save a valid workbook until the administrator confirms it', async() => {
    vi.spyOn(workbook,'parseFeesWorkbook').mockResolvedValue({fees:[{admissionNumber:'001',feeReference:'OCT',academicYear:'2026',dueDate:'2026-10-01',amount:'100',currency:'INR',description:''}],collections:[]});
    const counts={feesAdded:1,feesUpdated:0,feesUnchanged:0,collectionsAdded:0,collectionsUpdated:0,collectionsUnchanged:0};
    api.mockResolvedValueOnce({valid:true,revision:7,counts,rows:[],issues:[]}).mockResolvedValueOnce(counts);
    await act(async() => root.render(<FeesPage request={request} />));
    const input=host.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(input,'files',{value:[new File(['dummy'],'fees.xlsx')]});
    await act(async() => input.dispatchEvent(new Event('change',{bubbles:true})));
    expect(api).toHaveBeenCalledOnce();await click('Confirm add / update');
    expect(api.mock.calls[1][0]).toBe('/admin/fees/import-commit');expect(JSON.parse(api.mock.calls[1][1].body)).toMatchObject({revision:7,fees:[{admissionNumber:'001'}]});expect(host.textContent).toContain('Saved: 1 fees added');
  });
});
