// Abstracao unica de chamada ao LLM — independente do provedor (Gemini, Groq, ou futuros).
// A identidade do agente vive no banco de dados, nunca no modelo; trocar de provedor
// aqui nao deve exigir nenhuma mudanca na logica de identidade ou memoria.

import { callGemini } from './geminiClient';
import { callGroq } from './groqClient';

export type LLMProvider = 'gemini' | 'groq';

export async function callLLM(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  apiKeyOverride?: string
) {
  if (provider === 'groq') {
    return callGroq(systemPrompt, userPrompt, maxTokens);
  }
  return callGemini(systemPrompt, userPrompt, maxTokens, apiKeyOverride);
}
