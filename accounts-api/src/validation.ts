import { z } from 'zod';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(24).optional().or(z.literal('')),
  termsAccepted: z.literal(true),
  privacyNoticeVersion: z.string().trim().min(1).max(40),
}).strict();

export const emailSchema = z.string().trim().email().max(254).transform(normalizeEmail);
export const passwordSchema = z.string().min(12).max(128);
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).strict();
export const challengeSchema = z.object({
  challengeId: z.string().min(40).max(100),
  code: z.string().regex(/^\d{8}$/),
}).strict();

export type ProfileInput = z.infer<typeof profileSchema>;