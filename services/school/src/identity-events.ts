import { domainEventTypes } from '@schoolconnect/contracts';
import type { EventEnvelope } from '@schoolconnect/eventing';
export type MembershipState = { membershipId:string; userId:string; schoolId:string | null; role:string; status:string };
export async function applyIdentityEvent(envelope:EventEnvelope, resolve:(id:string)=>Promise<MembershipState>, apply:(event:EventEnvelope,current:MembershipState)=>Promise<void>) {
  if(envelope.source !== 'identity' || ![domainEventTypes.membershipUpdated,domainEventTypes.membershipRevoked].includes(envelope.event.eventType as typeof domainEventTypes.membershipUpdated)) return;
  const payload=envelope.event.payload;
  if(!['PARENT','TEACHER'].includes(String(payload.role))) return;
  const current=await resolve(envelope.event.aggregateId);
  if(current.membershipId!==envelope.event.aggregateId || current.schoolId!==payload.schoolId || current.role!==payload.role) throw new Error('MEMBERSHIP_EVENT_SCOPE_MISMATCH');
  // Resolve current ownership, not stale event ownership: redelivery/out-of-order moves cannot restore old access.
  await apply(envelope,current);
}
