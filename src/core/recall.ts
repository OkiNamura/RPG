/** Лёгкая память без embeddings: словарный отбор прошлых сцен. */
interface LogLike { turn: number; role: string; text: string }

function tokens(value: string): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

export function recallLog(log: LogLike[], input: string, limit = 4): string {
  const words = new Set(tokens(input));
  if (!words.size) return '';
  const scored = log
    .filter((entry) => entry.role === 'gm')
    .map((entry) => ({
      entry,
      score: tokens(entry.text).filter((word) => words.has(word)).length,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.turn - a.entry.turn)
    .slice(0, limit);
  if (!scored.length) return '';
  return ['Релевантные моменты прошлого:', ...scored.map(({ entry }) => `- ход ${entry.turn}: ${entry.text.replace(/\s+/g, ' ').slice(0, 240)}`)].join('\n');
}

/** Дешёвая режиссура: не даёт сцене схлопнуться в вопрос или пересказ. */
export function directorNote(present: number): string {
  const lines = [
    '[Режиссёр] Держи сцену открытой, но не заканчивай её вопросом к игроку.',
    'Показывай последствия поступков; не позволяй NPC знать то, чего они не видели.',
    'Не повторяй одну и ту же мысль разными словами; одна сцена — одно движение.',
  ];
  if (present > 1) {
    lines.push('В сцене несколько персонажей: дай им разные реакции, не превращай всех в один голос.');
  }
  return lines.join('\n');
}
