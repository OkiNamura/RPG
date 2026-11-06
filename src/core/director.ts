export interface DirectorInput {
  turn: number;
  hasScene: boolean;
  stalls: number;
  sceneId: string;
  lastSceneId?: string;
  lastTurn?: number;
}

/** Director — по событию, а не каждый ход; страховка раз в 3 хода. */
export function shouldRunDirector(input: DirectorInput): boolean {
  if (!input.hasScene) return true;
  if (input.stalls >= 2) return true;
  if (input.sceneId !== input.lastSceneId) return true;
  if (input.turn <= (input.lastTurn ?? -99)) return true;
  return input.turn - (input.lastTurn ?? -99) >= 3;
}
