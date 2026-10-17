import { useRef, useState } from 'react';
import { demoMode, loginPasscode, mobileApi, requestOtp, saveSession, setupPasscode, verifyOtp, type MobileSession } from './api';
import type { Role } from './domain';

// No role is requested before authentication. Only Identity-verified memberships
// can become a workspace; the server still authorizes every membership switch.
export function useMobileSignIn(onSignedIn:(role:Role,session?:MobileSession)=>void) {
  const [phase,setPhase]=useState<'phone'|'otp'|'setup'>('phone');
  const [mode,setMode]=useState<'login'|'activate'|'reset'>('login');
  const [phone,setPhone]=useState(demoMode ? '+91 98765 43210' : '');
  const [invitation,setInvitation]=useState(''),[otp,setOtp]=useState(''),[developmentCode,setDevelopmentCode]=useState('');
  const [passcode,setPasscode]=useState(''),[confirmation,setConfirmation]=useState(''),[setupToken,setSetupToken]=useState(''),[challengeId,setChallengeId]=useState('');
  const [loading,setLoading]=useState(false),[serverError,setServerError]=useState('');
  const [verifiedSession,setVerifiedSession]=useState<MobileSession|null>(null);
  const submitting=useRef(false);
  const changeMode=(next:'login'|'activate'|'reset')=>{
    if(submitting.current) return;
    setMode(next);setPhase('phone');setPasscode('');setConfirmation('');setOtp('');setInvitation('');setDevelopmentCode('');setChallengeId('');setSetupToken('');setServerError('');
  };
  const open=async(session:MobileSession,membershipId:string)=>{
    const membership=session.memberships.find((item)=>item.id===membershipId);
    if(!membership) throw Error('NO_ACTIVE_MEMBERSHIP');
    let selected=session;
    if((session.activeMembershipId ?? session.memberships[0]?.id)!==membershipId) {
      const result=await mobileApi.switchRole(session,membershipId);
      if(result.activeMembership.id!==membershipId || result.activeMembership.role!==membership.role) throw Error('WORKSPACE_SWITCH_INVALID');
      selected={...session,accessToken:result.accessToken,expiresInSeconds:result.expiresInSeconds,activeMembershipId:membershipId};
      setVerifiedSession(selected);
    }
    await saveSession(selected);onSignedIn(membership.role,selected);
  };
  const accept=async(session:MobileSession)=>{
    if(!session.memberships.length) throw Error('NO_ACTIVE_MEMBERSHIP');
    setPasscode('');setConfirmation('');setSetupToken('');
    if(session.memberships.length===1) {await open(session,session.memberships[0]!.id);return;}
    // Keep the verified session in memory, not persisted, until a workspace is chosen.
    setVerifiedSession(session);
    const context=await mobileApi.context(session);
    const memberships=context.memberships.map((membership)=>({...membership,
      schoolName:membership.schoolName ?? (membership.schoolId===context.school?.id ? context.school.displayName : undefined)}));
    setVerifiedSession({...session,memberships,activeMembershipId:context.principal.membershipId ?? session.activeMembershipId});
  };
  const submit=async()=>{
    if(submitting.current) return;submitting.current=true;setLoading(true);setServerError('');
    try {
      if(phase==='phone') {
        if(mode==='login') {
          if(demoMode){onSignedIn('PARENT');return;}
          await accept(await loginPasscode(phone,passcode));return;
        }
        if(demoMode){setDevelopmentCode('123456');setOtp('123456');}
        else {
          const result=await requestOtp(phone,invitation,mode==='reset' ? 'RESET' : 'ACTIVATE');
          setChallengeId(result.challengeId);setDevelopmentCode(result.developmentCode ?? '');setOtp(result.developmentCode ?? '');
        }
        setPhase('otp');
      } else if(phase==='otp') {
        if(demoMode){if(otp!=='123456')throw Error('OTP_INVALID_OR_EXPIRED');}
        else {const result=await verifyOtp(challengeId,otp);setSetupToken(result.setupToken);}
        setOtp('');setPhase('setup');
      } else {
        if(passcode!==confirmation)throw Error('PASSCODES_DO_NOT_MATCH');
        if(demoMode){onSignedIn('PARENT');return;}
        await accept(await setupPasscode(setupToken,passcode));
      }
    } catch(error){setServerError(error instanceof Error ? error.message : 'Unable to sign in. Please retry.');}
    finally{submitting.current=false;setLoading(false);}
  };
  const chooseWorkspace=async(id:string)=>{
    if(submitting.current || !verifiedSession)return;submitting.current=true;setLoading(true);setServerError('');
    try{await open(verifiedSession,id);}catch(error){setServerError(error instanceof Error ? error.message : 'WORKSPACE_SWITCH_FAILED');}
    finally{submitting.current=false;setLoading(false);}
  };
  const cancelWorkspace=async()=>{
    if(submitting.current || !verifiedSession)return;submitting.current=true;setLoading(true);setServerError('');
    try{await mobileApi.logout(verifiedSession);setVerifiedSession(null);setPhase('phone');setMode('login');}
    catch{setServerError('Unable to sign out. Check your connection and retry.');}
    finally{submitting.current=false;setLoading(false);}
  };
  return {phase,mode,phone,setPhone,invitation,setInvitation,otp,setOtp,developmentCode,passcode,setPasscode,confirmation,setConfirmation,loading,serverError,changeMode,submit,verifiedSession,chooseWorkspace,cancelWorkspace};
}
