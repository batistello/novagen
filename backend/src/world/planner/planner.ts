// Planner — traduz um objetivo escolhido pelo LLM em uma ou mais Tasks concretas.
// Hoje, com apenas um tipo real de Task implementado (hunt_wolf), o planner funciona
// como passagem direta (1 objetivo = 1 task). A estrutura ja esta pronta para decompor
// objetivos compostos (ex: "sobreviver" -> [buscar comida, fabricar arma, construir abrigo])
// assim que mais tipos de Task existirem no sistema.

export interface PlannedTaskItem {
  taskType: string;
  targetId: number | null;
  priority: number;
}

export function planGoal(goalType: string, targetId: number | null): PlannedTaskItem[] {
  switch (goalType) {
    case 'hunt_wolf_task':
      return [{ taskType: 'hunt_wolf', targetId, priority: 0 }];
    default:
      return [];
  }
}
