import { z } from 'zod';

export const mockEvalSchema = z.object({
  summary: z.string().describe('A concise summary of the content'),
  score: z.number().min(1).max(10).describe('Quality score from 1 to 10'),
  keywords: z.array(z.string()).describe('Key topics mentioned'),
});

export type MockEvalOutput = z.infer<typeof mockEvalSchema>;
