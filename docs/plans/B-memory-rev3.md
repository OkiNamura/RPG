# Очередь B: память (rev 3)

## Границы итерации

- Только `source: 'player'`. Записи агента не в этой итерации.
- `kind: 'fact' | 'journal'`.
- `pinned` — единственный признак постоянного блока.
- `learned`, `hidden`, `lastUsedTurn` не вводим.

## Хранение

- `MemoryEntry` лежит в `Session.memories` и `SavedCampaign.memories` (опционально).
- В `GameState` не лежит, поэтому undo/regenerate не стирают записи.
- Ветки: память общая для кампании (как заметки игрока), это осознанно.
- `restart` очищает `memories` вместе с остальной кампанией.
- `persist` пишет `memories`; `getSession` читает; старые файлы → `[]`.

## Контекст

Порядок:

```text
static → memory (pinned, стабильно)
→ conspect.frozen → history → conspect
→ lore.top → lore.history → lore.after
→ memory.recall → state → lore.depth → notes → turn
```

- Pinned: сортировка `importance desc, createdTurn asc, id asc`.
- Pinned: 8 записей / 4000 символов.
- Recall: 6 / 3000, после `lore.after`.
- Recall keys сверяются с вводом, местом и последними 4 сообщениями лога
  (нижний регистр, без второго матчера; используем простую проверку вхождения).
- Legacy `session.memory` (до 4000) остаётся отдельно; общий бюджет памяти 9k.
- 9-я pinned запись: API отвечает 400, не вытесняет молча.

## API

`POST /api/campaign/:id/memory-entry`

```json
{"action":"add|update|delete|pin|unpin","id":"...","text":"...","keys":["..."],"kind":"journal","importance":2}
```

- `session.busy` → 409.
- text ≤ 500, keys ≤ 8, записей ≤ 50.
- id генерирует сервер.
- pin при 8 pinned или 4000 chars → 400.
- ответ — актуальный список.

## UI

- Меню «Память».
- Модалка: список, добавить, pin/unpin, удалить, важность.
- Использует общий механизм модалок: Esc, фон, фокус-трап.
- Legacy «Память истории» остаётся.
- После изменения — обновление списка.
- PWA cache bump.

## Inspector

- `memory` и `memory.recall` — обычные сегменты.
- `lastMemoryReport` с pinned/recall/вытесненными; сохраняется в `data/inspectors`.

## Тесты

- старая кампания без memories;
- persist/load;
- pinned в контексте;
- recall по ключу;
- без ключа не попадает;
- 9-й pin → 400;
- busy → 409;
- сегменты до `conspect` стабильны при разном recall;
- undo/regenerate не удаляют player-записи.
