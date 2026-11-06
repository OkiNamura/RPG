# Очередь B: память (rev 2)

## Решение

Память живёт на уровне кампании/сессии, не в `GameState`.
Поэтому undo/regenerate/ветки не удаляют записи игрока.

```ts
MemoryEntry {
  id, kind: 'fact' | 'journal', text, keys[],
  importance: 1..3, pinned: boolean,
  createdTurn, source: 'player' | 'agent'
}
```

- `pinned` — единственный признак постоянного блока.
- `learned`/`hidden` — не в этой итерации.
- Старый `session.memory` остаётся как свободная заметка.

## Контекст

- Pinned — стабильный блок `memory` до истории, лимит 8/4000.
- Recall — отдельный `memory.recall` после истории, лимит 6/3000.
- Recall только по journal/fact с совпавшими ключами.
- Векторный recall не трогаем; дубли допустимы, но помечаем.
- В inspector — `memory`, `memory.recall`, pinned, recall, вытесненные.

## API

`POST /api/campaign/:id/memory-entry`

```json
{"action":"add|update|delete|pin|unpin","id":"...","text":"...","keys":["..."],"kind":"journal","importance":2}
```

- `session.busy` → 409.
- id генерируется на сервере.
- text ≤ 500, keys ≤ 8, записей ≤ 50.
- source=player.

## UI

- Меню «Память».
- Модалка: список, добавить, pin/unpin, удалить, важность.
- Существующая «Память истории» остаётся отдельной заметкой.
- После изменения — перезагрузка панели.

## Тесты

- память переживает undo (session-level);
- pinned в контексте;
- recall по ключу;
- без ключа не попадает;
- лимиты;
- API busy 409;
- старая кампания без memories.
