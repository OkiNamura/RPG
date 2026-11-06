# Очередь C: сцена и director (rev 2)

## C1. Сцена

`SceneState`:

```ts
question?: string;
closedTurn?: number;
closeReason?: string;
sceneHistory?: SceneState[]; // максимум 5
```

- `exitCost`/`stakes` убираем: нет источника и таймера.
- Закрытие:
  - смена места;
  - `stalls >= 3` подряд.
- Смена места: старая сцена копируется в `sceneHistory`, создаётся новая.
- `stalls >= 3`: ставим `closedTurn`/`closeReason`, новую сцену создаём на следующем ходе.
- `sceneHistory` не удаляет state; максимум 5.
- Старая кампания: `sceneHistory ??= []`; отсутствующие поля допустимы.
- В `renderState` — только текущая сцена + последняя закрытая (1 строка).
- UI panel — question и последняя закрытая.

## C2. Director

- `session.lastDirectorSceneId`, `lastDirectorTurn`, `lastDirectorText`.
- Вызов:
  - сцена новая (`scene.id !== lastDirectorSceneId`);
  - `stalls >= 2`;
  - прошло 3+ хода.
- Если вызов не нужен:
  - `lastDirectorText` подставляем как `[Режиссёр]`;
  - если текста нет — `directorNote`.
- Regenerate/edit в том же ходу получают тот же `lastDirectorText`.
- `question` новой сцены — из последнего Director-текста, иначе шаблон.

## C3. Свайпы

- Не добавляем отдельный UI.
- В CONTEXT: «варианты ответа (swipe-альтернативы)», не путать с жестом.

## Проверки

- 3 топтания подряд → closedTurn; 4-й ход — новая сцена;
- смена места → старая сцена в history;
- повторы через ход не закрывают;
- Director не каждый ход, при stalls>=2 вызывается;
- regenerate получает тот же Director-текст;
- старая кампания без sceneHistory;
- tsc, world-test, UI 42/42.
