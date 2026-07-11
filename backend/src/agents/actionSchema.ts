import { z } from 'zod';

const baseCoords = { x: z.number(), y: z.number() };

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('walk'), ...baseCoords }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('observe'), target: z.string().optional() }),
  z.object({ type: z.literal('approach'), targetAgentId: z.string() }),
  z.object({ type: z.literal('move_away'), targetAgentId: z.string() }),
  z.object({ type: z.literal('draw'), points: z.array(z.object({ x: z.number(), y: z.number() })), color: z.string().optional() }),
  z.object({ type: z.literal('create_object'), shape: z.string(), ...baseCoords, color: z.string().optional(), label: z.string().optional() }),
  z.object({ type: z.literal('remove_object'), objectId: z.number() }),
  z.object({ type: z.literal('rename_object'), objectId: z.number(), newLabel: z.string() }),
  z.object({ type: z.literal('move_object'), objectId: z.number(), ...baseCoords }),
  z.object({ type: z.literal('stack_object'), objectId: z.number(), onTopOfObjectId: z.number() }),
  z.object({ type: z.literal('rotate_object'), objectId: z.number(), degrees: z.number() }),
  z.object({ type: z.literal('color_object'), objectId: z.number(), color: z.string() }),
  z.object({ type: z.literal('measure_distance'), targetAgentId: z.string().optional(), objectId: z.number().optional() }),
  z.object({ type: z.literal('write'), text: z.string(), ...baseCoords }),
  z.object({ type: z.literal('think') }),
  z.object({ type: z.literal('wait') }),
  z.object({ type: z.literal('experiment'), description: z.string() }),
]);

export type Action = z.infer<typeof ActionSchema>;

export const AgentResponseSchema = z.object({
  speech: z.string().nullable(),
  thought: z.string(),
  emotion: z.string(),
  action: ActionSchema,
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// Fallback seguro quando o modelo retorna algo inválido/alucinado
export const FALLBACK_RESPONSE: AgentResponse = {
  speech: null,
  thought: 'Confuso, preciso de um instante.',
  emotion: 'confusion',
  action: { type: 'wait' },
};

export function parseAgentResponse(raw: unknown): AgentResponse {
  // Normaliza casos onde o LLM escreve a string "null" ao invés do valor JSON null
  if (raw && typeof raw === 'object' && 'speech' in raw) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.speech === 'string' && obj.speech.trim().toLowerCase() === 'null') {
      obj.speech = null;
    }
  }
  const result = AgentResponseSchema.safeParse(raw);
  if (result.success) return result.data;
  console.error('[actionSchema] Resposta inválida do LLM, usando fallback:', result.error.message);
  return FALLBACK_RESPONSE;
}
