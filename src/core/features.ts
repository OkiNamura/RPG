/** Глобальные выключатели новых механик. */
export interface FeatureFlags {
  contextInspector: boolean;
  advancedLore: boolean;
  branches: boolean;
  groupScenes: boolean;
  npcMinds: boolean;
  vectorMemory: boolean;
  storyDirector: boolean;
  imageQueue: boolean;
  imageProfiles: boolean;
  antiSlop: boolean;
  shops: boolean;
}

export const DEFAULT_FEATURES: FeatureFlags = {
  contextInspector: true,
  advancedLore: true,
  branches: true,
  groupScenes: true,
  npcMinds: true,
  vectorMemory: true,
  storyDirector: true,
  imageQueue: true,
  imageProfiles: true,
  antiSlop: true,
  shops: true,
};

export function normalizeFeatures(value: unknown): FeatureFlags {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<FeatureFlags>;
  const result = { ...DEFAULT_FEATURES };
  for (const key of Object.keys(DEFAULT_FEATURES) as (keyof FeatureFlags)[]) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  return result;
}
