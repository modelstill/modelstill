export const OTP_LENGTH = 6;

export function sanitizeOtp(value: string): string {
  return value.replace(/\D/g, "").slice(0, OTP_LENGTH);
}
