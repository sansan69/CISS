import { z } from 'zod';
const date = z.string().transform(value => value.slice(0,10)).refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value, 'Choose a valid date.');
export const guardLeaveSchema = z.object({
 type: z.string().trim().min(1).max(80).default('Annual'),
 startDate: date, endDate: date,
 reason: z.string().trim().min(1).max(500),
 clientRequestId: z.string().uuid().optional(),
}).refine(value=>value.endDate>=value.startDate, {message:'End date must follow start date.'});
