// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api=vi.hoisted(()=>({leaveApplications:vi.fn(),applyLeave:vi.fn(),acknowledgeLeave:vi.fn(),timetable:vi.fn(),publishTimetable:vi.fn(),resultCharts:vi.fn(),resultRoster:vi.fn(),recordResultScore:vi.fn()}));
vi.mock('./api',()=>({mobileApi:api}));
vi.mock('expo-crypto',()=>({randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'}));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:({children}:any)=><div>{children}</div>}));
vi.mock('./TeachingClassSelector',()=>({TeachingClassSelector:({selected,onSelect}:any)=><button onClick={()=>onSelect('second-assignment')}>Switch from {selected?.className}</button>}));
vi.mock('react-native',()=>({
  View:({children,accessibilityLabel}:any)=><div aria-label={accessibilityLabel}>{children}</div>,Text:({children}:any)=><span>{children}</span>,ScrollView:({children}:any)=><div>{children}</div>,
  Pressable:({children,disabled,onPress,accessibilityRole,accessibilityState}:any)=><button role={accessibilityRole} aria-checked={accessibilityState?.checked} disabled={disabled} onClick={onPress}>{children}</button>,
  TextInput:({value,onChangeText,accessibilityLabel}:any)=><input aria-label={accessibilityLabel} value={value} onChange={(event)=>onChangeText(event.target.value)}/>,
  ActivityIndicator:()=> <span>Loading</span>,StyleSheet:{create:(styles:unknown)=>styles},
}));
import { SchoolExperiences } from './SchoolExperiences';
let host:HTMLDivElement,root:Root;
const session={accessToken:'token',refreshToken:'refresh',expiresInSeconds:600,user:{id:'parent',displayName:'Parent'},memberships:[]};
const assignment={assignmentId:'assignment',classId:'class',className:'Grade 3',subjectName:'Math',subjectCode:'MATH',canPublishResults:true,canPublishAnnouncements:false,canRecordAttendance:false};
const common={session,studentId:'child',studentName:'Mohammed Safwan',assignment,scope:[assignment],schoolName:'Nexqon School',onSelect:vi.fn(),onBack:vi.fn()};
const leave={id:'leave',classId:'class',studentId:'child',studentName:'Mohammed Safwan',startDate:'2026-10-20',endDate:'2026-10-21',reason:'Medical appointment',status:'SUBMITTED',createdAt:'2026-10-17'};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.values(api).forEach((method)=>method.mockReset());common.onSelect.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);api.leaveApplications.mockResolvedValue([]);api.resultRoster.mockResolvedValue([]);api.resultCharts.mockResolvedValue({points:[]});api.timetable.mockResolvedValue(null);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=async(feature:'leave-applications'|'timetable'|'result-charts',teacher=false)=>act(async()=>{root.render(<SchoolExperiences {...common} feature={feature} teacher={teacher}/>);});
const click=async(text:string)=>act(async()=>{[...host.querySelectorAll('button')].find((button)=>button.textContent===text)!.click();});
const input=async(label:string,value:string)=>act(async()=>{const field=host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});
describe('school experience screens',()=>{
  it('submits a dated parent application from the selected child context',async()=>{
    await render('leave-applications');await input('From date (YYYY-MM-DD)','2026-10-20');await input('To date (YYYY-MM-DD)','2026-10-21');await input('Reason','Medical appointment');await click('Submit to teacher');
    expect(api.applyLeave).toHaveBeenCalledWith(session,{studentId:'child',startDate:'2026-10-20',endDate:'2026-10-21',reason:'Medical appointment'});
    expect(host.textContent).toContain('Mohammed Safwan');
  });
  it('lets teachers acknowledge a full student name as one application',async()=>{
    api.leaveApplications.mockResolvedValue([leave]);await render('leave-applications',true);await input('Reply (optional)','Received');await click('Acknowledge application');expect(api.acknowledgeLeave).toHaveBeenCalledWith(session,'leave','Received');expect(host.textContent).not.toContain('Apply for leave');
  });
  it('shows parent acknowledgement status and teacher reply',async()=>{
    api.leaveApplications.mockResolvedValue([{...leave,status:'ACKNOWLEDGED',acknowledgementNote:'Received, thank you'}]);await render('leave-applications');expect(host.textContent).toContain('Acknowledged by teacher');expect(host.textContent).toContain('Teacher reply: Received, thank you');
  });
  it('keeps the latest timetable visible read-only to parents',async()=>{
    api.timetable.mockResolvedValue({id:'tt',classId:'class',version:2,title:'Weekly timetable',publishedAt:'2026-10-17',slots:[{day:1,start:'08:00',end:'09:00',subject:'Math'}]});await render('timetable');expect(api.timetable).toHaveBeenCalledWith(session,false,'child');expect(host.textContent).toContain('Monday');expect(host.textContent).toContain('Math');expect(host.textContent).not.toContain('Update timetable');
  });
  it('shows an actionable empty state instead of invented chart data',async()=>{
    await render('result-charts');expect(host.textContent).toContain('No numeric result data yet');expect(host.textContent).not.toContain('Publish numeric result');
  });
  it('labels chart values and permits class switching on teacher charts',async()=>{
    api.resultCharts.mockResolvedValue({points:[{examName:'Term 1',subjectName:'Math',percentage:80,count:2,resultDate:'2026-10-17'}]});await render('result-charts',true);expect(host.textContent).toContain('80.0%');expect(host.textContent).toContain('Class average scores');expect(api.resultRoster).toHaveBeenCalledWith(session,'class');await click('Switch from Grade 3');expect(common.onSelect).toHaveBeenCalledWith('second-assignment');
  });
  it('shows connection failures without publishing or treating stale data as current',async()=>{
    api.timetable.mockRejectedValue(Error('SERVICE_UNAVAILABLE'));await render('timetable',true);expect(host.textContent).toContain('SERVICE UNAVAILABLE');expect(api.publishTimetable).not.toHaveBeenCalled();
  });
  it('publishes a structured timetable for the selected teaching class',async()=>{
    await render('timetable',true);await input('Subject','Mathematics');await click('Add lesson');await click('Publish timetable to parents');
    expect(api.publishTimetable).toHaveBeenCalledWith(session,{classId:'class',title:'Weekly timetable',expectedVersion:0,slots:[{day:1,start:'08:00',end:'09:00',subject:'Mathematics'}]});
  });
  it('publishes numeric results with the actual class and selected student',async()=>{
    api.resultRoster.mockResolvedValue([{id:'child',displayName:'Mohammed Safwan'}]);await render('result-charts',true);await click('○ Mohammed Safwan');await input('Exam name','Term 1');await input('Marks obtained','80');await click('Publish private result');
    expect(api.recordResultScore).toHaveBeenCalledWith(session,expect.objectContaining({classId:'class',studentId:'child',examName:'Term 1',subjectName:'Math',marksObtained:80,maxMarks:100,idempotencyKey:'123e4567-e89b-42d3-a456-426614174000'}));
  });
});
