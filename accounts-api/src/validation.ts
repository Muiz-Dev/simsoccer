import { z } from 'zod';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const provisionSchema = z.object({
  phone: z.string().trim().min(7).max(24).optional().or(z.literal('')),
}).strict();

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(24),
  termsAccepted: z.literal(true),
  privacyNoticeVersion: z.string().trim().min(1).max(40),
}).strict();

export type ProfileInput = z.infer<typeof profileSchema>;