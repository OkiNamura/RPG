# Claude Pair v0.2 — план rev2

## 0. Проверка pre-step (до кода)

Контракт из установленного `dsh-agent`:

```js
ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
  // вернуть next({ ...decision, messages })
})
```

Проверить на живом харнессе: system-блок виден в следующем запросе; async ждётся.
Если нет — `@claude` не делаем, остальное отдельно.

## 1. claudeBin

- `claudeBin` только из config плагина.
- Нет значения → `STATUS: ERROR (claudeBin не задан)`.
- `cordis.patch.yml` содержит абсолютный путь.
- Обёртка `claude-review.mjs` берёт путь из `CLAUDE_BIN` env; плагин выставляет env
  для общего bridge. Это единственное исключение, потому что hook не видит config.

## 2. Один bridge

```text
~/dsh-plugins/claude-pair/lib/claude.mjs
```

Экспорт:

- `askClaude`;
- `reviewDiff`;
- `runReview` (общий вход для wrapper);
- `readRules`.

`claude-review.mjs` — только dynamic import:

```js
pathToFileURL(process.env.CLAUDE_PAIR_LIB || defaultPath)
```

Нет файла → exit 1 с текстом, не stacktrace.
`reviewDiff` и hook используют один pathspec и `GIT_BIN`:
`git diff HEAD --binary -- . ':!docs/reviews' ':!docs/room.log'`.

## 3. @claude

- Ловить `agent/pre-step`.
- Триггер: последняя user-реплика начинается с `@claude`.
- Ключ дедупликации: id реплики, иначе sha1 текста + turn.
- Один spawn на реплику; ответ кэшируется в памяти на turn.
- В промт Claude: последние 15 реплик.
- Блок вставляется **в конец**, перед последней user-репликой, как system:
  `CLAUDE VERBATIM: ...` + инструкция «сначала цитата, затем мнение».
- Блок не пишется в session log и не повторяется на втором шаге.
- ERROR/LIMIT вставляется так же, DeepSeek не выдумывает.
- Если `pre-step` уже обработал этот message id — `next()` без вызова.

## 4. Поля

`ask_claude` и `claude_review`:

```ts
{ ok, limited, resetAt, verdict, text }
```

- `verdict`: `'ОК' | 'НЕ ОК' | null`.
- `resetAt`: ISO или null.
- числа: `undefined`/NaN → null, не 0.
- `text` начинается с `STATUS: ...`.
- `output.schema` и `render` содержат все поля.

## 5. Rules

`docs/CLAUDE-RULES.md` — единственный источник.
Нет файла/пустой → ERROR.
Запреты секретов остаются в `--disallowedTools`.

## 6. Approvals

- только явный `ВЕРДИКТ: ОК`;
- hash before/after, не писать при пустом/ошибке;
- атомарная запись read-modify-write;
- `verdict:'ОК'`;
- тот же hash, что у hook;
- wrapper и plugin используют `reviewDiff`.

## Тесты

- pre-step contract на живом харнессе;
- один spawn на повторный шаг;
- ERROR/LIMIT status;
- pre-step не рекурсирует;
- claudeBin отсутствует;
- wrapper без lib;
- approval hash + hook;
- поля и null;
- старые approvals/state.
