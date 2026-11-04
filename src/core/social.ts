/**
 * Детерминированная социальная реакция — страховка поверх агента состояния.
 * Не заменяет его, а гарантирует, что удар по ребёнку или члену пати
 * не останется без последствий даже при «мягком» ответе модели.
 */
import type { GameState } from './state.ts';

export interface SocialResult {
  publicDelta: number;
  changed: string[];
  witnesses: string[];
}

const VIOLENCE = /(бью|удар|пинаю|пинок|толкаю|душу|бью|избива|раню|убива|режу|швыря|бросаю в|унижа|оскорб|плюю)/i;
const HELP = /(помога|спаса|защища|лечу|перевяз|поднимаю|успокаива|извиня|мирю|кормлю|делюсь|утеша)/i;
const IGNORE = /(игнориру|прохожу мимо|не обраща|оставляю|бросаю|не помога|отворачива)/i;
const JOKE = /(шучу|пошути|сарказм|издева|смеюсь|насмеш|чёрн|черн)/i;
const WEAK = /(ребен|ребён|девоч|девочк|мальчик|мальчиш|старик|старух|слаб|нищ|бродяг|котен|щен)/i;

function hasName(text: string, name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (normalized.length < 2) return false;
  if (text.toLowerCase().includes(normalized)) return true;
  // Простые падежи: Соня → Соню, Марк → Марка.
  const stem = normalized.length >= 5 ? normalized.slice(0, -1) : normalized.length >= 4 ? normalized.slice(0, -1) : normalized;
  return stem.length >= 3 && text.toLowerCase().includes(stem);
}

export function applySocialReaction(state: GameState, input: string): SocialResult {
  const text = String(input ?? '');
  const lower = text.toLowerCase();
  const result: SocialResult = { publicDelta: 0, changed: [], witnesses: [] };
  const present = [...state.party, ...state.npcs].filter(
    (actor) => actor.present !== false && actor.status === 'alive' && !actor.archived,
  );
  const target = present.find((actor) => hasName(lower, actor.name));
  const violence = VIOLENCE.test(lower);
  const help = HELP.test(lower);
  const ignore = IGNORE.test(lower);
  const joke = JOKE.test(lower);
  if (!violence && !help && !ignore && !joke) return result;

  const weak = WEAK.test(lower);
  state.reputation ??= { public: 0, label: 'нейтрально', witnesses: [] };
  const before = state.reputation.public;

  if (violence) {
    result.publicDelta -= weak ? 12 : target ? 8 : 5;
    if (target) {
      target.attitude = Math.max(-100, (target.attitude ?? 0) - (weak ? 45 : 30));
      target.morale = Math.max(0, (target.morale ?? 50) - 15);
      result.changed.push(`${target.name}: отношение упало`);
      if (state.party.includes(target)) {
        for (const member of state.party) {
          if (member === target) continue;
          member.attitude = Math.max(-100, (member.attitude ?? 0) - (weak ? 18 : 12));
          member.morale = Math.max(0, (member.morale ?? 50) - (weak ? 12 : 8));
        }
        result.changed.push('пати: дух и доверие упали');
      }
    } else if (weak) {
      for (const member of state.party) {
        member.attitude = Math.max(-100, (member.attitude ?? 0) - 5);
        member.morale = Math.max(0, (member.morale ?? 50) - 4);
      }
      result.changed.push('пати: не одобряет жестокость');
    }
    result.witnesses.push(state.place);
  } else if (help) {
    result.publicDelta += weak ? 8 : 4;
    for (const member of state.party) {
      member.attitude = Math.min(100, (member.attitude ?? 0) + 3);
      member.morale = Math.min(100, (member.morale ?? 50) + 4);
    }
    if (target) {
      target.attitude = Math.min(100, (target.attitude ?? 0) + 10);
      result.changed.push(`${target.name}: отношение выросло`);
    }
    result.witnesses.push(state.place);
  } else if (ignore) {
    result.publicDelta -= weak ? 4 : 2;
    for (const member of state.party) {
      member.morale = Math.max(0, (member.morale ?? 50) - 2);
    }
    result.witnesses.push(state.place);
  } else if (joke) {
    result.publicDelta -= 1;
    for (const member of state.party) {
      const harsh = /(жесток|мёртв|смерт|кров|ребен|ребён)/i.test(lower);
      member.attitude = Math.max(-100, (member.attitude ?? 0) + (harsh ? -5 : 2));
    }
  }

  state.reputation.public = Math.max(-100, Math.min(100, state.reputation.public + result.publicDelta));
  if (state.reputation.public !== before) {
    state.reputation.witnesses = [...new Set([...(state.reputation.witnesses ?? []), ...result.witnesses])].slice(-20);
    state.reputation.label =
      state.reputation.public >= 60 ? 'герой общества' :
      state.reputation.public >= 20 ? 'уважаемый' :
      state.reputation.public >= 5 ? 'доброжелательный' :
      state.reputation.public <= -60 ? 'изгой' :
      state.reputation.public <= -20 ? 'опасный' :
      state.reputation.public <= -5 ? 'подозрительный' : 'нейтрально';
    result.changed.push(`репутация: ${before} → ${state.reputation.public}`);
  }
  return result;
}
