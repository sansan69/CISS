export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

const DEFAULT_TEXT_MODEL =
  process.env.OPENROUTER_WAGE_MODEL ||
  process.env.OPENROUTER_DEFAULT_MODEL ||
  "openrouter/free";

const DEFAULT_VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL ||
  process.env.OPENROUTER_DEFAULT_MODEL ||
  "openrouter/free";

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]+?)```/i);
  if (fenced?.[1]) return fenced[1];
  const objectLike = text.match(/\{[\s\S]+\}/);
  if (objectLike?.[0]) return objectLike[0];
  const arrayLike = text.match(/\[[\s\S]+\]/);
  return arrayLike?.[0] ?? text;
}

function getOptionalHeaders() {
  return {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://cisskerala.site",
    "X-Title": process.env.OPENROUTER_APP_NAME || "CISS Workforce",
  };
}

export function hasOpenRouter() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenRouterJsonOptions {
  prompt: string;
  schema: Record<string, unknown>;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  imageDataUrl?: string;
}

export async function requestOpenRouterJson<T>({
  prompt,
  schema,
  systemPrompt = "Return only valid JSON matching the requested schema.",
  model = DEFAULT_TEXT_MODEL,
  maxTokens = 1200,
  temperature = 0.1,
  imageDataUrl,
}: OpenRouterJsonOptions): Promise<{ data: T; model: string }> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const userContent: OpenRouterContentPart[] = [{ type: "text", text: prompt }];
  if (imageDataUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: imageDataUrl },
    });
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      ...getOptionalHeaders(),
    },
    body: JSON.stringify({
      model: imageDataUrl ? DEFAULT_VISION_MODEL : model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ciss_structured_response",
          strict: true,
          schema,
        },
      },
      plugins: [{ id: "response-healing" }],
    }),
  });

  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      raw?.error?.message ||
      raw?.message ||
      `OpenRouter request failed with status ${response.status}`;
    throw new Error(message);
  }

  const text =
    raw?.choices?.[0]?.message?.content ||
    raw?.choices?.[0]?.text ||
    raw?.choices?.[0]?.message?.reasoning ||
    "";

  return {
    data: JSON.parse(extractJson(String(text))) as T,
    model: raw?.model || model,
  };
}

