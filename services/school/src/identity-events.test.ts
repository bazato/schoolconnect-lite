import {describe,it,expect,vi} from 'vitest';
import {domainEventTypes} from '@schoolconnect/contracts';
import type {EventEnvelope} from '@schoolconnect/eventing';
import {applyIdentityEvent} from './identity-events';
const event:EventEnvelope={source:'identity',event:{id:'event',eventType:domainEventTypes.membershipUpdated,aggregateId:'member',occurredAt:new Date().toISOString(),payload:{schoolId:'school',role:'PARENT',previousUserId:'old',userId:'intermediate'}}};
describe('school identity-event boundary',()=>{
  it('resolves current ownership rather than restoring stale phone ownership',async()=>{const resolve=vi.fn().mockResolvedValue({membershipId:'member',schoolId:'school',role:'PARENT',userId:'latest',status:'ACTIVE'});const apply=vi.fn();await applyIdentityEvent(event,resolve,apply);expect(apply).toHaveBeenCalledWith(event,expect.objectContaining({userId:'latest'}));});
  it('rejects cross-school events',async()=>{const apply=vi.fn();await expect(applyIdentityEvent(event,async()=>({membershipId:'member',schoolId:'other',role:'PARENT',userId:'latest',status:'ACTIVE'}),apply)).rejects.toThrow('SCOPE_MISMATCH');expect(apply).not.toHaveBeenCalled();});
  it('ignores other sources and unrelated roles',async()=>{const resolve=vi.fn();const apply=vi.fn();await applyIdentityEvent({...event,source:'school'},resolve,apply);await applyIdentityEvent({...event,event:{...event.event,payload:{role:'SCHOOL_ADMIN'}}},resolve,apply);expect(resolve).not.toHaveBeenCalled();});
});
