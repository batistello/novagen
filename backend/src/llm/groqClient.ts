import dotenv from 'dotenv';
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

export interface LLMResult {
  raw: unknown;
  totalTokens: number;
}

export async function callGroq(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY não configurada no .env');
  }

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt + '\n\nResponda APENAS em JSON válido, sem markdown, sem texto extra.' },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 800,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '{}';
  const totalTokens = data.usage?.total_tokens ?? 0;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    raw = null;
  }

  return { raw, totalTokens };
}
