// Formalizacao dos 4 gatilhos que justificam chamar o LLM de novo (Fase 5 da arquitetura).
//
// Hoje, apenas Tasks migradas para o novo padrao (ex: hunt_wolf) respeitam 100% estes gatilhos
// sem depender de reprensamento por tempo. Acoes ainda nao migradas (a maioria) continuam usando
// duration_minutes como aproximacao do gatilho "terminou o objetivo atual", ate serem migradas
// individualmente em fases futuras — isso evita quebrar comportamento existente.

export type WakeTrigger = 'no_active_goal' | 'goal_finished' | 'unexpected_event' | 'plan_impossible';

export interface WakeDecision {
  shouldWake: boolean;
  trigger: WakeTrigger | null;
}

// Gatilho 1: nao existe objetivo ativo algum.
export function hasNoActiveGoal(hasIntention: boolean): boolean {
  return !hasIntention;
}

// Gatilho 2: o objetivo atual terminou (task concluida, ou intencao expirou/foi interrompida).
export function hasGoalFinished(intentionExpiredOrInterrupted: boolean, taskStillRunning: boolean): boolean {
  return !taskStillRunning && intentionExpiredOrInterrupted;
}

// Gatilho 3: algo inesperado aconteceu (ataque, proximidade critica, descoberta importante).
export function hasUnexpectedEvent(proximityInterrupted: boolean, tookDamageThisTick: boolean): boolean {
  return proximityInterrupted || tookDamageThisTick;
}

// Gatilho 4: o plano se tornou impossivel de concluir.
// Estrutura pronta para uso futuro — nenhuma Task atual ainda relata essa condicao.
export function hasPlanBecomeImpossible(taskFailedReason: string | null): boolean {
  return taskFailedReason != null && taskFailedReason !== 'concluido';
}

export function evaluateWakeDecision(params: {
  hasIntention: boolean;
  taskStillRunning: boolean;
  intentionExpiredOrInterrupted: boolean;
  proximityInterrupted: boolean;
  tookDamageThisTick: boolean;
  taskFailedReason: string | null;
}): WakeDecision {
  if (hasNoActiveGoal(params.hasIntention)) return { shouldWake: true, trigger: 'no_active_goal' };
  if (hasPlanBecomeImpossible(params.taskFailedReason)) return { shouldWake: true, trigger: 'plan_impossible' };
  if (hasUnexpectedEvent(params.proximityInterrupted, params.tookDamageThisTick)) return { shouldWake: true, trigger: 'unexpected_event' };
  if (hasGoalFinished(params.intentionExpiredOrInterrupted, params.taskStillRunning)) return { shouldWake: true, trigger: 'goal_finished' };
  return { shouldWake: false, trigger: null };
}
