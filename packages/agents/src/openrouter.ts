type JsonRecord = Record<string, unknown>;

export interface OpenRouterJsonOptions {
  model: string;
  system: string;
  user: string;
  temperature?: number;
}

export interface OpenRouterJsonResponse<T> {
  data: T | null;
  model: string;
  rawText: string;
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) return objectMatch[0];

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) return arrayMatch[0];

  return trimmed;
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export async function callOpenRouterJson<T = JsonRecord>(
  input: OpenRouterJsonOptions
): Promise<OpenRouterJsonResponse<T>> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("openrouter_not_configured");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature ?? 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`openrouter_request_failed:${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = String(payload.choices?.[0]?.message?.content ?? "").trim();
  const jsonText = extractJsonPayload(rawText);
  if (!jsonText) {
    throw new Error("openrouter_empty_response");
  }

  try {
    return {
      data: JSON.parse(jsonText) as T,
      model: input.model,
      rawText
    };
  } catch {
    throw new Error("openrouter_json_parse_failed");
  }
}
