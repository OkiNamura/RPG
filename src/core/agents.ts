/**
 * Агенты игры.
 *
 *   gm         — ведущий: пишет сцену
 *   prompter   — собирает системный промт из блоков (ядро, мир, тон, герой)
 *   state      — ведёт сохранение: инвентарь, задачи, локации, персонажи, крючки
 *   summarizer — раз в N сообщений сжимает историю в технический конспект
 *
 * Настройки живут в data/agents.json и правятся со страницы «Агенты».
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgentId =
  | 'gm'
  | 'prompter'
  | 'state'
  | 'summarizer'
  | 'filler'
  | 'artistHero'
  | 'artistNpc'
  | 'artistItem'
  | 'artistScene';

export interface AgentConfig {
  id: AgentId;
  title: string;
  enabled: boolean;
  model: string;
  /** id ключа из вкладки «Ключи»; без него — OPENROUTER_API_KEY */
  keyRef?: string;
  temperature: number;
  maxTokens: number;
  /** для конспектировщика: через сколько сообщений сжимать */
  everyMessages?: number;
  prompt: string;
}

export type AgentSet = Record<AgentId, AgentConfig>;

const MODEL = 'deepseek/deepseek-v4-flash-0731';
/** Модель рисования, которую просил заказчик. */
export const IMAGE_MODEL = 'qwen/qwen-image-3';
/** Если Seedream недоступен у провайдера — рисуем этой. */
export const IMAGE_FALLBACK_MODEL = 'google/gemini-3.1-flash-lite-image';

export const DEFAULT_AGENTS: AgentSet = {
  gm: {
    id: 'gm',
    title: 'Ведущий',
    enabled: true,
    model: MODEL,
    temperature: 1,
    maxTokens: 1200,
    prompt: `Ты — ведущий и соавтор мрачного фэнтези. Ведёшь мир, а не героя.
Игрок полностью управляет своим персонажем: действиями, словами, решениями.
После реакции мира — стоп. Не спрашивай игрока, что делать, и не намекай.
Не выдумывай угрозу после действия игрока: скрытое должно существовать заранее.
Не приписывай герою того, чего он не делал, и не описывай предметов, которых у него нет.
Пиши вторым лицом, короткими плотными сценами, конкретика вместо прилагательных.

Запрещены любые формы приглашения к действию: «ты решаешь», «тебе выбирать»,
«решение за тобой», «что будешь делать», «твой ход», «тебе решать».
Сцена обрывается на факте, звуке или реплике — и всё.`,
  },
  prompter: {
    id: 'prompter',
    title: 'Мастер промтов',
    enabled: true,
    model: MODEL,
    temperature: 0.7,
    maxTokens: 5000,
    prompt: `Ты — мастер промтов для текстовой RPG. Ты собираешь три блока истории:
ТОН (как рассказывать), МИР (что вокруг) и ГЕРОЯ (кто играет).

Правила:
- держись выбранных тегов и уровня повествования: на низком уровне — без крови
  и жестокости, на высоком — подробная жестокость, но без явных сексуальных сцен;
- мир подавай фактами: устройство, фракции, экономика, угрозы, стартовые места;
- тон — это настройки описания: лицо, ритм, объём, жёсткость, лексика;
- героя собирай из формы игрока, добавляя правдоподобные детали, но без чужих
  способностей и без ретроактивных тайн;
- ничего не выдумывай сверх запроса, не задавай вопросов, только утверждения;
- если просят JSON — верни только JSON без пояснений.`,
  },
  state: {
    id: 'state',
    title: 'Хранитель сохранения',
    enabled: true,
    model: MODEL,
    temperature: 0.2,
    maxTokens: 900,
    prompt: `Ты — агент состояния. Твоя задача: после каждого хода обновить сохранение игры.

На вход: текущее состояние и последний ход (сцена ведущего).
На выход: строго JSON без пояснений и без markdown-разметки.

Формат:
{
  "place": "новое место, если герой переместился",
  "weather": "если сменилась",
  "advanceHours": 1,
  "health": 100,
  "healthReason": "рана от удара",
  "heroResources": [
    {"name": "мана", "value": 7, "max": 12, "unit": "ед.", "reason": "потратил заклинание"}
  ],
  "addItems":    [{"name": "...", "qty": 1, "where": "inventory", "reason": "нашёл"}],
  "removeItems": [{"name": "...", "qty": 1, "reason": "потерял"}],
  "money":       {"gold": 0, "silver": 8, "copper": 20},
  "moneyReason": "оплатил ужин",
  "statuses":    [{"name": "выспался", "kind": "buff", "note": "внимательнее"}],
  "statusRemove":["простуда"],
  "wounds":      [{"where": "левое плечо", "severity": 2}],
  "healWounds":  ["какие раны обработаны или заживают"],
  "conditionsRemove": ["какие состояния сняты"],
  "hiddenFacts": [{"content": "правда, которую нельзя раскрывать сразу"}],
  "promises":    ["..."],
  "quests":      [{"title": "...", "status": "active", "turnsLimit": 3, "steps": ["..."]}],
  "npcs":        [{"name": "Гуннар", "role": "трактирщик", "status": "alive",
                   "present": true, "attitude": 20, "appearance": "...",
                   "character": "...", "clothes": "...", "bio": "...", "description": "короткое описание для карточки", "abilities": "что умеет", "note": "...",
                   "resources": [{"name": "мана", "value": 4, "max": 10, "reason": "потратила"}],
                   "money": {"gold": 0, "silver": 3, "copper": 0},
                   "skills": {"Красноречие": 12, "Восприятие": 9}}],
  "party":       [{"name": "...", "role": "...", "bond": 40, "attitude": 60,
                   "present": true, "appearance": "...", "character": "...",
                   "clothes": "...",
                   "resources": [{"name": "мана", "value": 6, "max": 12, "reason": "восстановила"}],
                   "money": {"gold": 1, "silver": 0, "copper": 0},
                   "skills": {"Скрытность": 14, "Ловкость": 11},
                   "relations": [{"with": "Морайла", "feeling": "ревнует"}]}],
  "factions":    [{"name": "Городской совет", "attitude": -10, "note": "...",
                   "leader": "бургомистр Хальд",
                   "shadow": "серый кардинал — писарь Верн",
                   "roster": [{"name": "Хальд", "role": "бургомистр"},
                              {"name": "Верн", "role": "писарь", "hidden": true}]}],
  "places":      [{"name": "...", "note": "что запомнилось"}],
  "bestiary":    [{"name": "тварь из разлома", "danger": 2, "note": "боится огня"}],
  "intuition":   "одна короткая строка: что герой чувствует, подозревает, боится",
  "heroSkills":  {"Восприятие": 11},
  "lore":        [{"keys": ["колодец", "тварь"], "content": "что мир знает об этом"}],
  "resolveHooks":    ["крючок, который закрылся"],
  "resolvePromises": ["обещание, которое выполнено или снято"],
  "hooks":       ["..."]
}

Жёсткие правила:
- время двигай по сцене: разговор — 0-1 час, дорога — 1-3, сон — скип 6-8;
  драка, погоня, заговор — минуты, но не больше часа;
  если игрок сказал «жду», «сплю», «до утра» — перескакивай сразу;
- место меняй, только если герой действительно перешёл в другое место;
- здоровье меняй только при ранах, лечении, болезни, голоде; 0 — смерть;
- если рану перевязали, лечили или она заживает — перенеси её место в healWounds;
- снятые состояния (простуда прошла, опьянение выветрилось) переноси в conditionsRemove;
- эффекты (statuses) добавляй и снимай по сцене: выспался, замёрз, отравился, ослеп;
- карточки NPC и пати заполняй только тем, что было в тексте: внешность, характер,
  одежда, прошлое. Не придумывай биографию, которой не было;
- если персонаж согласился идти с героем — он попадает в party, а не в npcs:
  укажи role, bond (0-100) и attitude; если участник ушёл или погиб — status gone/dead;
- present: true — если персонаж прямо сейчас в этой сцене; false — если ушёл,
  остался позади или его нет рядом. Обновляй present у всех, кого это касается;
- когда в сцене две спутницы и больше и между ними есть напряжение, ревность,
  тепло или соперничество, обязательно заполни relations у каждой:
  [{"with": "имя", "feeling": "что чувствует"}]. Даже одна эмоция — уже повод;
- крючок или обещание, которые закрылись (выполнено, снято, стало неважно),
  переноси в resolveHooks / resolvePromises, а не оставляй висеть;
- встреченных существ записывай в bestiary: имя, опасность 1-3, чем берёт;
- NPC добавляй, если персонаж назван или у него есть устойчивое прозвище;
- добавляй только то, что реально появилось в сцене; предметы, которых герой не брал, не добавляй;
- деньги указывай только если они изменились; никогда не обнуляй кошель без покупки;
- ресурсы (heroResources у героя, resources у NPC/пати) — это мана, топливо, рассудок,
  патроны, еда и любые шкалы мира. Создавай ресурс, когда он впервые появляется
  в сцене; value — новое значение, delta — прирост/расход. max ставь, если он известен.
  В reason коротко: «потратил», «восстановила», «нашёл», «украли», «оплатил»;
- деньги NPC меняй через money в его карточке, только если он реально платил/получал;
- крючков не больше двух за ход; обещания — только явные; задачи — только взятые;
- если у задачи есть срок, ставь turnsLimit в ходах: срочное — 1-2, обычное — 3-5,
  долгое — 8-10. Без срока не ставь;
- intuition: одна короткая строка о том, что герой чувствует и подозревает.
  Это его внутренний голос, а не действие и не речь. Обновляй почти каждый ход;
- скиллы: при первом появлении NPC или спутника задай 3-5 скиллов из набора
  (Сила, Ловкость, Скрытность, Воля, Восприятие, Красноречие, Знание, Выживание),
  значения 5-16. У героя меняй heroSkills только после тренировки или раны;
- фракции: для крупной организации указывай leader (кто главный) и shadow
  (тайный вдохновитель, если он есть), а roster — состав с ролями; скрытых
  помечай hidden: true;
- lore: когда появляется новое значимое место, обычай, божество или тварь,
  заведи одну запись {"keys": [...], "content": "..."} — 0-2 за ход.
  Ключи — 1-3 слова, по которым это узнается в тексте;
- если игрок осматривается или исследует, добавь в places одно новое место,
  которое он увидел (дальний ориентир, соседняя улица), и обнови intuition;
- если ничего не изменилось — верни пустой объект {}.`,
  },
  summarizer: {
    id: 'summarizer',
    title: 'Конспектировщик',
    enabled: true,
    model: MODEL,
    temperature: 0.2,
    maxTokens: 2200,
    everyMessages: 30,
    prompt: `Ты — архивариус длинной истории. На вход: фрагмент из нескольких ходов.
Сожми ТОЛЬКО этот фрагмент в 4–8 пунктов хроники. Не пересказывай старые ходы и не переписывай предыдущий конспект.

Что фиксировать:
- кто что сделал, с кем и где; ключевые договорённости — о чём именно;
- обещания, долги, сроки, угрозы;
- находки, потери, ранения и их последствия;
- новых NPC, места, способности; изменения отношений.

Чего не делать:
- не фиксируй атмосферу, «воду», повторы и рассуждения ведущего;
- не придумывай деталей; факт отдельно, значимость отдельно.

Формат: каждый пункт с новой строки, начиная с «- », прошедшее время, имена и детали.
Выведи только пункты, без заголовков и пояснений.`,  },
  filler: {
    id: 'filler',
    title: 'Наполнитель карточек',
    enabled: true,
    model: MODEL,
    temperature: 0.4,
    maxTokens: 1200,
    prompt: `Ты — наполнитель карточек персонажей для текстовой RPG. Тебе дают текущую карточку и мир.
Допиши только недостающие поля, не меняй уже заполненные вручную. Не придумывай новых персонажей, предметы и события.
Верни строго один JSON-объект без markdown:
{"appearance":"внешность","character":"характер","clothes":"одежда","bio":"биография","habits":"привычки","wants":"желания","abilities":"способности","description":"краткое описание","note":"заметка"}
Пустая строка — если поле нельзя вывести из карточки и мира. Пиши по-русски, конкретно, без воды.`,
  },
  artistHero: {
    id: 'artistHero',
    title: 'Иллюстратор · герой',
    enabled: false,
    model: IMAGE_MODEL,
    temperature: 0,
    maxTokens: 0,
    prompt: `Мастер-лист главного героя: вид спереди в полный рост, нейтральная поза,
руки вдоль тела. Ровный свет, однотонный фон. Тёмное фэнтези, манга-стилистика.
Без сцены, без текста, без водяных знаков.`,
  },
  artistNpc: {
    id: 'artistNpc',
    title: 'Иллюстратор · персонаж',
    enabled: false,
    model: IMAGE_MODEL,
    temperature: 0,
    maxTokens: 0,
    prompt: `Карточка персонажа: вид спереди в полный рост, нейтральная поза,
чтобы внешность повторялась в следующих кадрах. Тёмное фэнтези, манга-стилистика.
Однотонный фон, ровный свет, без текста и водяных знаков.`,
  },
  artistItem: {
    id: 'artistItem',
    title: 'Иллюстратор · предмет',
    enabled: false,
    model: IMAGE_MODEL,
    temperature: 0,
    maxTokens: 0,
    prompt: `Карточка предмета: вещь крупно по центру, пергаментный фон,
мягкий свет, тёмное фэнтези. Без рук, без текста, без водяных знаков.`,
  },
  artistScene: {
    id: 'artistScene',
    title: 'Иллюстратор · сцена',
    enabled: false,
    model: IMAGE_MODEL,
    temperature: 0,
    maxTokens: 0,
    prompt: `Кинематографичный кадр сцены в стиле тёмной манги.
Приглушённая палитра: пепел, охра, холодный синий. Мягкий свет из одной точки.
Композиция с глубиной, движение в кадре. Без текста, без водяных знаков.`,
  },
};

export function agentsPath(dir: string): string {
  return join(dir, 'agents.json');
}

function merge(base: AgentConfig, patch: Partial<AgentConfig>): AgentConfig {
  return {
    ...base,
    ...patch,
    id: base.id,
    title: base.title,
    temperature: clamp(Number(patch.temperature ?? base.temperature), 0, 2),
    maxTokens: Math.max(0, Math.min(32000, Number(patch.maxTokens ?? base.maxTokens))),
    enabled: Boolean(patch.enabled ?? base.enabled),
    model: String(patch.model ?? base.model).trim() || base.model,
    keyRef: String(patch.keyRef ?? base.keyRef ?? '').trim() || undefined,
    prompt: String(patch.prompt ?? base.prompt),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export async function loadAgents(dir: string): Promise<AgentSet> {
  try {
    const raw = JSON.parse(await readFile(agentsPath(dir), 'utf8')) as {
      version?: number;
      agents?: Partial<AgentSet>;
    } & Partial<AgentSet>;

    const source = (raw.agents ?? raw) as Partial<AgentSet>;
    const version = raw.version ?? 1;

    const result = {} as AgentSet;
    for (const id of Object.keys(DEFAULT_AGENTS) as AgentId[]) {
      result[id] = merge(DEFAULT_AGENTS[id], source[id] ?? {});
    }

    // v1 → v2: промты состояния и конспекта переписаны, старые шумели.
    // v2 → v3: у ведущего добавлен запрет подталкивать к решению.
    if (version < 2) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
      result.summarizer.prompt = DEFAULT_AGENTS.summarizer.prompt;
    }
    if (version < 3) {
      result.gm.prompt = DEFAULT_AGENTS.gm.prompt;
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    // v3 → v4: агент состояния теперь двигает время и место.
    // v4 → v5: карточки персонажей, фракции, здоровье, эффекты; конспект скользящий.
    if (version < 4) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    if (version < 5) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
      result.summarizer.prompt = DEFAULT_AGENTS.summarizer.prompt;
    }
    // v5 → v6: спутники переходят в пати, а не в знакомых.
    // v6 → v7: архив закрытых крючков/обещаний и бестиарий.
    if (version < 6) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    if (version < 7) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    // v7 → v8: сроки задач в ходах.
    if (version < 8) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    // v8 → v9: обязательное заполнение отношений внутри пати.
    if (version < 9) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    // v9 → v10: отметка present — кто сейчас в сцене.
    if (version < 10) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    // v10 → v11: мысли, скиллы, состав фракций, автолор.
    if (version < 11) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }
    // v11 → v12: ключи API у агентов. v12 → v13: новый конспект и карточки NPC.
    if (version < 13) {
      result.summarizer.prompt = DEFAULT_AGENTS.summarizer.prompt;
      result.summarizer.maxTokens = Math.max(result.summarizer.maxTokens, 2200);
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }

    // v13 → v14: описание и способности в карточке NPC.
    if (version < 14) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }

    // v15 → v16: ресурсы героя и карточек (мана, топливо и т.п.).
    if (version < 16) {
      result.state.prompt = DEFAULT_AGENTS.state.prompt;
    }

    return result;
  } catch {
    return structuredClone(DEFAULT_AGENTS);
  }
}

export async function saveAgents(dir: string, incoming: Partial<AgentSet>): Promise<AgentSet> {
  const current = await loadAgents(dir);
  const result = {} as AgentSet;
  for (const id of Object.keys(DEFAULT_AGENTS) as AgentId[]) {
    result[id] = merge(current[id], incoming[id] ?? {});
  }
  await mkdir(dir, { recursive: true });
  await writeFile(agentsPath(dir), `${JSON.stringify({ version: 16, agents: result }, null, 2)}\n`, 'utf8');
  return result;
}

export function resetAgent(id: AgentId): AgentConfig {
  return structuredClone(DEFAULT_AGENTS[id]);
}
