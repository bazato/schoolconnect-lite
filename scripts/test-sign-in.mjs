import { randomUUID } from 'node:crypto';

// Synthetic local regression accounts only. Never fall back to resetting credentials.
export async function testSignIn(base, phoneE164, invitationCode, deviceId=`test-${randomUUID()}`) {
  const passcode = process.env.TEST_LOGIN_PASSCODE ?? '8642';
  const send = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) });
    const payload = await response.json();
    return { response,payload };
  };
  const loggedIn = await send('/auth/passcode/login',{phoneE164,passcode,deviceId});
  if (loggedIn.response.ok) return {...loggedIn.payload,deviceId};
  let challenge = await send('/auth/otp/request',{phoneE164,invitationCode});
  if (!challenge.response.ok && JSON.stringify(challenge.payload).includes('INVITATION_OR_PHONE_INVALID')) challenge = await send('/auth/otp/request',{phoneE164});
  if (!challenge.response.ok) throw new Error(`TEST_LOGIN_FAILED: ${JSON.stringify(challenge.payload)} (set TEST_LOGIN_PASSCODE for previously activated test accounts)`);
  const verified = await send('/auth/otp/verify',{challengeId:challenge.payload.challengeId,code:challenge.payload.developmentCode ?? '123456',deviceId});
  if (!verified.response.ok) throw new Error(`TEST_VERIFY_FAILED: ${JSON.stringify(verified.payload)}`);
  const setup = await send('/auth/passcode/setup',{setupToken:verified.payload.setupToken,passcode,deviceId});
  if (!setup.response.ok) throw new Error(`TEST_SETUP_FAILED: ${JSON.stringify(setup.payload)}`);
  return {...setup.payload,deviceId};
}
