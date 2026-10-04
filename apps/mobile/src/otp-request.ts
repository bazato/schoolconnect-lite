export async function withReturningMemberFallback<T>(invitationCode: string, send: (code: string) => Promise<T>): Promise<T> {
  try {
    return await send(invitationCode);
  } catch (error) {
    // An invitation is single-use; activated members authenticate without it.
    if (invitationCode.trim() && error instanceof Error && error.message === 'INVITATION_OR_PHONE_INVALID') return send('');
    throw error;
  }
}
