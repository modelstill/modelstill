import type { Auth } from "./index.ts";

type OnboardingUser = { onboardedAt?: Date | string | null };

export async function markOnboarded(auth: Auth, userId: string): Promise<Date> {
  const context = await auth.$context;
  const user = (await context.internalAdapter.findUserById(userId)) as OnboardingUser | null;
  if (user?.onboardedAt) return new Date(user.onboardedAt);
  const now = new Date();
  await context.internalAdapter.updateUser(userId, { onboardedAt: now });
  return now;
}
