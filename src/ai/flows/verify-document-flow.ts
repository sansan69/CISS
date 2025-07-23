'use server';
/**
 * @fileOverview An AI flow to verify document types from images.
 *
 * - verifyDocument - A function that checks if an uploaded document matches an expected type.
 */

import {ai} from '@/ai/genkit';
import { VerifyDocumentInputSchema, VerifyDocumentOutputSchema, type VerifyDocumentInput, type VerifyDocumentOutput } from '@/ai/schemas/document-verification';
import {googleAI} from '@genkit-ai/googleai';

const verifyDocumentFlow = ai.defineFlow(
  {
    name: 'verifyDocumentFlow',
    inputSchema: VerifyDocumentInputSchema,
    outputSchema: VerifyDocumentOutputSchema,
  },
  async (input) => {
    const {output} = await ai.generate({
      model: googleAI('gemini-1.5-flash'),
      prompt: [
        {
          text: `You are an expert document verification agent. Your task is to determine if the document in the provided image matches the expected document type.

The user expects the document to be a '${input.expectedType}'.

Analyze the image and determine if it is indeed a '${input.expectedType}'.

- If the document in the image IS a '${input.expectedType}', set isMatch to true.
- If the document in the image IS NOT a '${input.expectedType}', set isMatch to false. For example, if the user expects a "School Certificate" but uploads an "Aadhar Card", that is a mismatch.
- Provide a very short, one-sentence reason for your decision.`,
        },
        {media: {url: input.photoDataUri}},
      ],
      output: {
        schema: VerifyDocumentOutputSchema,
      },
    });
    
    if (!output) {
      throw new Error("The AI model did not return a valid response.");
    }
    return output;
  }
);


export async function verifyDocument(input: VerifyDocumentInput): Promise<VerifyDocumentOutput> {
  return verifyDocumentFlow(input);
}
