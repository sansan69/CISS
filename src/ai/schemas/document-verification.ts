import {z} from 'zod';

/**
 * @fileOverview Zod schemas for the document verification flow.
 *
 * This file contains the input and output schemas used by the
 * AI-powered document verification flow. It is separated from the
 * main flow logic to avoid Next.js 'use server' build errors, as
 * these schemas need to be imported into client-side components.
 *
 * - VerifyDocumentInputSchema: The Zod schema for the input to the verification flow.
 * - VerifyDocumentInput: The TypeScript type inferred from the input schema.
 * - VerifyDocumentOutputSchema: The Zod schema for the output of the verification flow.
 * - VerifyDocumentOutput: The TypeScript type inferred from the output schema.
 */

export const VerifyDocumentInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  expectedType: z.string().describe('The expected type of the document (e.g., "PAN Card", "Aadhar Card").'),
});
export type VerifyDocumentInput = z.infer<typeof VerifyDocumentInputSchema>;

export const VerifyDocumentOutputSchema = z.object({
  isMatch: z.boolean().describe('Whether the document in the image matches the expected type.'),
  reason: z.string().describe('A brief explanation for the decision.'),
});
export type VerifyDocumentOutput = z.infer<typeof VerifyDocumentOutputSchema>;
