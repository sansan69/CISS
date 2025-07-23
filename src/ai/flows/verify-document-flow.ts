'use server';
/**
 * @fileOverview An AI flow to verify document types from images.
 *
 * - verifyDocument - A function that checks if an uploaded document matches an expected type.
 */

import {ai} from '@/ai/genkit';
import { VerifyDocumentInputSchema, VerifyDocumentOutputSchema, type VerifyDocumentInput, type VerifyDocumentOutput } from '@/ai/schemas/document-verification';
import {googleAI} from '@genkit-ai/googleai';

const verifyPrompt = ai.definePrompt({
    name: 'verifyDocumentPrompt',
    input: {schema: VerifyDocumentInputSchema},
    output: {schema: VerifyDocumentOutputSchema},
    model: googleAI('gemini-1.5-flash'),
    prompt: `You are an expert document verification agent. Your task is to determine if the document in the provided image matches the expected document type.

The user expects the document to be a '{{expectedType}}'.

Analyze the image and determine if it is indeed a '{{expectedType}}'.

- If the document in the image IS a '{{expectedType}}', set isMatch to true.
- If the document in the image IS NOT a '{{expectedType}}', set isMatch to false. For example, if the user expects a "School Certificate" but uploads an "Aadhar Card", that is a mismatch.
- Provide a very short, one-sentence reason for your decision.

Image to analyze:
{{media url=photoDataUri}}
`,
});


const verifyDocumentFlow = ai.defineFlow(
  {
    name: 'verifyDocumentFlow',
    inputSchema: VerifyDocumentInputSchema,
    outputSchema: VerifyDocumentOutputSchema,
  },
  async (input) => {
    const {output} = await verifyPrompt(input);
    if (!output) {
      throw new Error("The AI model did not return a valid response.");
    }
    return output;
  }
);

export async function verifyDocument(input: VerifyDocumentInput): Promise<VerifyDocumentOutput> {
  return verifyDocumentFlow(input);
}
