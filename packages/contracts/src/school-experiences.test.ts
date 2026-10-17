import { describe, expect, it } from 'vitest';
import { validateLeaveApplication, validateTimetable } from './school-experiences';
const leave={startDate:'2026-10-20',endDate:'2026-10-21',reason:'Medical appointment'};
const timetable={title:'Weekly timetable',expectedVersion:0,slots:[{day:1,start:'08:00',end:'09:00',subject:' Mathematics '}]};
describe('school experience validation',()=>{
  it('accepts real dates and bounded reasons',()=>{expect(()=>validateLeaveApplication(leave)).not.toThrow();});
  it.each([{startDate:'2026-02-30'},{endDate:'2026-10-19'},{reason:'a'},{reason:'x'.repeat(2001)}])('rejects invalid leave application %j',(change)=>{expect(()=>validateLeaveApplication({...leave,...change})).toThrow('LEAVE_APPLICATION_INVALID');});
  it('sorts and trims valid timetable entries',()=>{expect(validateTimetable(timetable)).toEqual([{day:1,start:'08:00',end:'09:00',subject:'Mathematics'}]);});
  it.each([{expectedVersion:-1},{expectedVersion:1.2},{slots:[]},{title:''},{slots:[{day:8,start:'08:00',end:'09:00',subject:'Math'}]},{slots:[{day:1,start:'24:00',end:'25:00',subject:'Math'}]},{slots:[{day:1,start:'09:00',end:'08:00',subject:'Math'}]}])('rejects invalid timetable %j',(change)=>{expect(()=>validateTimetable({...timetable,...change})).toThrow();});
  it('rejects overlap but permits adjacent periods',()=>{
    expect(()=>validateTimetable({...timetable,slots:[...timetable.slots,{day:1,start:'08:30',end:'09:30',subject:'English'}]})).toThrow('TIMETABLE_OVERLAP');
    expect(()=>validateTimetable({...timetable,slots:[...timetable.slots,{day:1,start:'09:00',end:'10:00',subject:'English'}]})).not.toThrow();
  });
});
