import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

let _ai: ReturnType<typeof genkit> | null = null;

/**
 * Lazy getter for the Genkit AI instance.
 * Callers should invoke getAi() and handle the case where it returns null
 * (meaning the GEMINI_API_KEY is not configured).
 */
export function getAi(): ReturnType<typeof genkit> {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        'GEMINI_API_KEY environment variable not set. Please get one from Google AI Studio and add it to your .env file.'
      );
    }
    _ai = genkit({
      plugins: [googleAI({apiKey: process.env.GEMINI_API_KEY})],
    });
  }
  return _ai;
}

// Backward-compatible export for existing importers — throws at call time if key missing
export const ai = new Proxy({} as ReturnType<typeof genkit>, {
  get(_, prop) { return (getAi() as any)[prop]; },
});