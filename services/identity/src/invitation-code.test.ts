import {describe,it,expect} from 'vitest';
import {encryptInvitationCode,decryptInvitationCode} from './invitation-code';
const env={NODE_ENV:'test',INVITATION_CODE_KEY:'synthetic-invitation-key-01234567890123456789'};
describe('repeatable admin activation-code display',()=>{
  it('encrypts at rest and can redisplay after a fresh decrypt',()=>{const stored=encryptInvitationCode('SC-SYNTHETIC','invite-1',env);expect(stored).not.toContain('SC-SYNTHETIC');expect(decryptInvitationCode(stored,'invite-1',env)).toBe('SC-SYNTHETIC');});
  it('uses a unique nonce and binds ciphertext to its invitation',()=>{const a=encryptInvitationCode('SC-TEST','one',env);expect(encryptInvitationCode('SC-TEST','one',env)).not.toBe(a);expect(decryptInvitationCode(a,'two',env)).toBeNull();});
  it('does not expose legacy, corrupt or old-key ciphertext',()=>{expect(decryptInvitationCode(null,'one',env)).toBeNull();expect(decryptInvitationCode('v1:invalid','one',env)).toBeNull();const a=encryptInvitationCode('SC-TEST','one',env);expect(decryptInvitationCode(a,'one',{...env,INVITATION_CODE_KEY:'different-key-012345678901234567890123'})).toBeNull();});
  it('fails closed on missing/short production keys',()=>{expect(()=>encryptInvitationCode('SC-TEST','one',{NODE_ENV:'production'})).toThrow();expect(()=>encryptInvitationCode('SC-TEST','one',{NODE_ENV:'production',INVITATION_CODE_KEY:'short'})).toThrow();});
});
