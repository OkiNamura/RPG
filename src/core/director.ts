export interface DirectorInput {
  turn: number;
  hasScene: boolean;
  stalls: number;
  sceneId: string;
  lastSceneId?: string;
  lastTurn?: number;
}

/** Вопрос сцены — только явная строка Director с вопросительным знаком. */
export function directorQuestion(text: string): string | undefined {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((item) => item.replace(/^#+\s*/, '').trim())
    .find((item) => item.includes('?'));
  return line ? line.slice(0, 160) : undefined;
}

/** Director — по событию, а не каждый ход; страховка раз в 3 хода. */
export function shouldRunDirector(input: DirectorInput): boolean {
  if (!input.hasScene) return true;
  if (input.stalls === 2) return true;
  if (input.sceneId !== input.lastSceneId) return true;
  if (input.turn <= (input.lastTurn ?? -99)) return true;
  return input.turn - (input.lastTurn ?? -99) >= 3;
}
