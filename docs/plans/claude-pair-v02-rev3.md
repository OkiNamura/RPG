# Claude Pair v0.2 — rev3

## 1. Config

Один файл:

```text
~/.dsh-plugins/claude-pair/config.json
```

Читают plugin и `claude-review.mjs`.
`claudeBin` только оттуда; нет файла/поля → ERROR, hook fail closed.
`cordis.patch.yml` создаёт/задаёт те же значения при установке.

## 2. Один bridge

```text
~/dsh-plugins/claude-pair/lib/claude.mjs
```

`buildDiff(repo)` — **единственный** сборщик:
`git diff HEAD --binary -- . ':!docs/reviews' ':!docs/room.log'`.
Hook импортирует его, wrapper тоже.

Экспорт: `askClaude`, `reviewDiff`, `runReview`, `buildDiff`, `readRules`.

Wrapper: dynamic import через `pathToFileURL`; lib нет → exit 1.
Approvals: temp file + rename, без lock. Не писать при пустом хэше/ошибке.
Только `ВЕРДИКТ: ОК`.

## 3. @claude

- `agent/pre-step` ловит user-реплику с `@claude`.
- `room.log` — источник правды.
- Ключ: `messageId`; fallback `sha1(text)+sessionId`.
- Перед spawn: искать ответ с этим ключом в room.log; если есть — не вызывать.
- На каждом шаге вставлять последние N ответов `@claude` из room.log.
- Предпочтительный способ — постоянное сообщение в сессию:

```js
session.append('system/message', {
  role: 'system',
  content: [{ type: 'text', text: 'CLAUDE VERBATIM: ...' }],
}, { surfaceOp: 'append' })
```

- Если append недоступен/запрещён — fallback: `messages` в `pre-step`.
- Ответ не дублировать: один `messageId` → один system block.
- ERROR/LIMIT тоже сохраняются как system block.
- DeepSeek получает инструкцию: сначала цитата, затем мнение.
- Если ответа нет — вызвать Claude; после ответа записать room.log и system block.

## 4. Поля

`{ ok, limited, resetAt, verdict, text }`:
- `verdict: 'ОК'|'НЕ ОК'|null`;
- числа finite или null;
- `text` первая строка `STATUS: ...`;
- schema/render включают все поля.

## 5. Rules

`docs/CLAUDE-RULES.md` — единственный источник.
Нет/пусто → ERROR.
Секреты — в `--disallowedTools`.

## 6. Тесты

- hook без config → fail closed;
- wrapper без lib → exit 1;
- один `messageId` → один spawn;
- room.log переживает шаг;
- system block не дублируется;
- ERROR/LIMIT;
- approvals hash/temp rename;
- hook импортирует buildDiff;
- старые approvals.
