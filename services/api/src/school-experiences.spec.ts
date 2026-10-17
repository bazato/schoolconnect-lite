import { Test } from '@nestjs/testing';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule, ServiceClient } from './app.module';

const parent={userId:'parent',membershipId:'pm',schoolId:'school',role:'PARENT',displayName:'Parent',sessionId:'session'};
const teacher={...parent,userId:'teacher',membershipId:'tm',role:'TEACHER'};
describe('school experience HTTP boundaries (mock downstream services)',()=>{
  let app:INestApplication;let principal=parent;let allowed=true;
  const clients={request:vi.fn()};
  beforeEach(async()=>{
    principal=parent;allowed=true;clients.request.mockReset();
    clients.request.mockImplementation(async(service:string,path:string,init?:RequestInit)=>{
      if(path==='/internal/v1/sessions/context') return principal;
      if(service==='authorization') {
        const body=JSON.parse(String(init?.body));
        if(path.endsWith('/route')) return {allowed:body.path.includes('/parent/') ? principal.role==='PARENT' : principal.role==='TEACHER'};
        return {allowed};
      }
      if(path==='/internal/v1/schools/school') return {active:true};
      if(path.endsWith('/children')) return [{id:'child',classId:'real-class'}];
      if(path.endsWith('/teacher-memberships')) return [{membershipId:'tm'}];
      if(path.includes('/members?role=TEACHER')) return [{membershipId:'tm',userId:'teacher',status:'ACTIVE'},{membershipId:'foreign',userId:'foreign',status:'ACTIVE'}];
      if(path.endsWith('/roster')) return [{id:'child',displayName:'Full Student Name',admissionNumber:'A01'}];
      if(path.endsWith('/recipients')) return [{studentId:'child',guardianUserId:'parent'},{studentId:'sibling',guardianUserId:'another'}];
      if(path==='/internal/v1/leave-applications/application?schoolId=school') return {classId:'real-class'};
      return {ok:true};
    });
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(ServiceClient).useValue(clients).compile();app=module.createNestApplication();app.setGlobalPrefix('api/v1');await app.init();
  });
  afterEach(async()=>{await app?.close();});
  const sent=(service:string,path:string)=>JSON.parse(String(clients.request.mock.calls.find((call)=>call[0]===service && call[1]===path)?.[2]?.body));
  it('derives the leave class, guardian and school server-side, not from the submitted body',async()=>{
    await request(app.getHttpServer()).post('/api/v1/parent/leave-applications').set('Authorization','Bearer x').send({studentId:'child',classId:'forged',schoolId:'forged',guardianUserId:'forged',startDate:'2026-10-20',endDate:'2026-10-21',reason:'Medical appointment'}).expect(201);
    expect(sent('attendance','/internal/v1/leave-applications')).toMatchObject({studentId:'child',classId:'real-class',schoolId:'school',guardianUserId:'parent',teacherUserIds:['teacher']});
  });
  it.each(['leave-applications','timetable','result-charts'])('denies unrelated child access for %s before reaching the data service',async(feature)=>{
    allowed=false;await request(app.getHttpServer()).get(`/api/v1/parent/${feature}?studentId=foreign`).set('Authorization','Bearer x').expect(403);
    expect(clients.request.mock.calls.some(([service])=>['attendance','content'].includes(service))).toBe(false);
  });
  it('derives the parent timetable class from the child, ignoring the supplied class',async()=>{
    await request(app.getHttpServer()).get('/api/v1/parent/timetable?studentId=child&classId=forged').set('Authorization','Bearer x').expect(200);
    expect(clients.request).toHaveBeenCalledWith('content','/internal/v1/timetable?schoolId=school&classId=real-class');
  });
  it('keeps parent charts filtered by guardian as well as student',async()=>{
    await request(app.getHttpServer()).get('/api/v1/parent/result-charts?studentId=child').set('Authorization','Bearer x').expect(200);
    expect(clients.request).toHaveBeenCalledWith('content','/internal/v1/result-charts?schoolId=school&studentId=child&guardianUserIds=parent');
  });
  it('checks the application’s actual class before acknowledgement and rejects a revoked assignment',async()=>{
    principal=teacher;allowed=false;
    await request(app.getHttpServer()).post('/api/v1/teacher/leave-applications/application/acknowledge').set('Authorization','Bearer x').send({classId:'forged'}).expect(403);
    const policy=clients.request.mock.calls.find((call)=>call[1]==='/internal/v1/decisions');expect(JSON.parse(String(policy?.[2]?.body))).toMatchObject({classId:'real-class',capability:'CLASS'});
    expect(clients.request.mock.calls.some(([,path])=>path.endsWith('/acknowledge'))).toBe(false);
  });
  it('publishes numeric results only to the selected student’s guardians',async()=>{
    principal=teacher;await request(app.getHttpServer()).post('/api/v1/teacher/result-scores').set('Authorization','Bearer x').send({classId:'real-class',studentId:'child',examName:'Term 1',subjectName:'Math',marksObtained:80,maxMarks:100,idempotencyKey:'key'}).expect(201);
    const result=sent('content','/internal/v1/results/bulk-publish');expect(result.rows).toHaveLength(1);expect(result.rows[0].recipients).toEqual([{studentId:'child',guardianUserId:'parent'}]);expect(result.actorUserId).toBe('teacher');
  });
  it('blocks foreign-class numeric result targets',async()=>{
    principal=teacher;await request(app.getHttpServer()).post('/api/v1/teacher/result-scores').set('Authorization','Bearer x').send({classId:'real-class',studentId:'foreign'}).expect(403);
    expect(clients.request.mock.calls.some(([,path])=>path.endsWith('/bulk-publish'))).toBe(false);
  });
  it('parents cannot publish timetables and teachers cannot submit parent leave applications',async()=>{
    await request(app.getHttpServer()).post('/api/v1/teacher/timetable').set('Authorization','Bearer x').send({}).expect(403);
    principal=teacher;await request(app.getHttpServer()).post('/api/v1/parent/leave-applications').set('Authorization','Bearer x').send({}).expect(403);
  });
  it('propagates relationship-service failure without writing business data',async()=>{
    const original=clients.request.getMockImplementation()!;clients.request.mockImplementation((service:string,path:string,init?:RequestInit)=>service==='authorization' && !path.endsWith('/route') ? Promise.reject(new ForbiddenException()) : original(service,path,init));
    await request(app.getHttpServer()).get('/api/v1/parent/timetable?studentId=child').set('Authorization','Bearer x').expect(403);
    expect(clients.request.mock.calls.some(([service])=>service==='content')).toBe(false);
  });
});
