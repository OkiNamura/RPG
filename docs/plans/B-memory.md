# Очередь B: память

Цель: управляемая память вместо одного растущего summary.
Не ломать старые кампании: `memories ??= []`.

## B1. Модель

В `GameState`:

```ts
interface MemoryEntry {
  id: string;
  kind: 'persistent' | 'journal' | 'learned';
  text: string;
  keys: string[];
  importance: 1 | 2 | 3;
  pinned: boolean;
  hidden?: boolean;
  createdTurn: number;
  lastUsedTurn?: number;
  source?: string;
}
```

- `persistent` — важные факты, всегда в контексте, пока pinned.
- `journal` — записи игрока/события, recall по ключам.
- `learned` — короткий блок отношений/линий, обновляемый редко.
- `normalizeState`: `memories ??= []`, проверка полей.

## B2. Контекст

- Permanent: pinned entries, лимит 8 записей / 4000 символов, в порядке важности.
- Retrievable: journal/learned, совпадение ключей с вводом, лимит 6 / 3000.
- Если ничего не совпало — не добавлять.
- `Memory Inspector` показывает:
  - постоянные;
  - recalled с причиной;
  - вытесненные по бюджету.
- Существующий `memory` (строкой) остаётся, объединяется с entries.

## B3. API и UI

- `POST /api/campaign/:id/memory`:
  - `add` / `update` / `delete` / `pin` / `unpin`;
  - текст, keys, kind, importance.
- Панель «Память»:
  - список;
  - pin/unpin;
  - удалить;
  - добавить journal.
- Модалка «Память» с фильтром и счётчиками.

## B4. Агент

- Агент состояния может добавить `memories` в дельту, но только:
  - короткий факт;
  - с ключами;
  - без дублей.
- Промт: не превращать каждый ход в запись; только важное.
- Код ограничивает длину и количество.

## B5. Бюджет

- Permanent и recall не должны превышать лимиты.
- Вытеснение: pinned важнее, свежее важнее.
- В Context Inspector видны `memory.persistent` и `memory.recall`.

## Проверки

- старая кампания без `memories` открывается;
- pinned попадает в контекст всегда;
- journal без совпадения ключей не попадает;
- recall по ключу попадает;
- pin/unpin/delete через API;
- лимиты не превышаются;
- tsc, UI 42/42, a11y.
