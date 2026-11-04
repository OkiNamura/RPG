/**
 * Визуальный контракт сцены.
 *
 * Иллюстратор не должен получать «последние 900 знаков прозы» и сам решать,
 * кто в кадре. Сначала состояние превращается в явный список участников,
 * запретов и референсов, потом из него собирается промт.
 */

export interface VisualReference {
  name: string;
  url: string;
  role: 'hero' | 'party' | 'npc' | 'location';
}

export interface SceneActor {
  name: string;
  role: string;
  appearance?: string;
  clothes?: string;
  description?: string;
  present?: boolean;
  status?: string;
}

export interface SceneContract {
  place: string;
  location?: string;
  time: string;
  weather: string;
  hero: { name: string; description?: string };
  cast: { name: string; description: string }[];
  action: string;
  forbidden: string[];
  references: VisualReference[];
}

export function buildSceneContract(params: {
  place: string;
  location?: string;
  time: string;
  weather: string;
  hero: { name: string; description?: string };
  actors: SceneActor[];
  action: string;
  references: VisualReference[];
}): SceneContract {
  const present = params.actors.filter(
    (actor) => actor.present !== false && actor.status !== 'dead' && actor.status !== 'gone',
  );
  const presentNames = new Set(present.map((actor) => actor.name));
  const cast = present
    .filter((actor) => actor.name !== params.hero.name)
    .map((actor) => ({
      name: actor.name,
      description: [actor.role, actor.appearance, actor.clothes, actor.description]
        .filter(Boolean)
        .join('; ')
        .slice(0, 260),
    }));
  const forbidden = params.actors
    .filter((actor) => !presentNames.has(actor.name))
    .map((actor) => actor.name)
    .filter(Boolean)
    .slice(0, 12);
  return {
    place: params.place,
    location: params.location,
    time: params.time,
    weather: params.weather,
    hero: params.hero,
    cast,
    action: params.action.replace(/\s+/g, ' ').slice(0, 900),
    forbidden,
    references: params.references,
  };
}

/** Порядок референсов важен: он попадает в промт как «Reference 1 = имя». */
export function referenceLegend(refs: VisualReference[]): string {
  if (!refs.length) return '';
  return refs
    .slice(0, 9)
    .map((ref, index) => `Reference ${index + 1}: ${ref.name} (${ref.role})`)
    .join('; ') + '. Держи лица, причёски и одежду по этим референсам.';
}

export function sceneSeed(parts: (string | number)[]): number {
  let hash = 2166136261;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}
