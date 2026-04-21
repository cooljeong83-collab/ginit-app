import { requestPhoneHint } from 'rn-phonenumber-detector';

export async function requestPhoneNumberHint(): Promise<string | null> {
  try {
    const e164 = await requestPhoneHint();
    return e164?.trim() || null;
  } catch {
    return null;
  }
}

