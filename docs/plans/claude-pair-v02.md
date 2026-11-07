# Claude Pair v0.2 — план

## 1. Claude bin

- `claudeBin` только из config. Никакого поиска `claude.exe` и fallback `'claude'`.
- Нет `claudeBin` → tool возвращает `STATUS: ERROR (claudeBin не задан)`.
- В `cordis.patch.yml` указывается абсолютный путь.

## 2. Один мост

Пакет вне PRG:

```text
~/dsh-plugins/claude-pair/lib/claude.mjs
```

Экспортирует:

- `askClaude({ prompt, plan, discussion, messages? })`;
- `reviewDiff({ base, task, repo })`:
  - снимок `git diff HEAD --binary -- . ':!docs/reviews' ':!docs/room.log'`;
  - хэш до, промт с диффом;
  - хэш после; не совпал → нет approval;
  - только явный `ВЕРДИКТ: ОК`;
  - approval в `~/.dsh-plugins/claude-pair/approvals.json`;
- `readRules(repo)` — читает `docs/CLAUDE-RULES.md`.

Tools:

- `ask_claude` — обсуждение/вопрос;
- `claude_review` — `stage: plan|diff`, `task`, `base?`.

`scripts/claude-review.mjs` — тонкая обёртка: динамически импортирует `lib/claude.mjs` и вызывает `runReview`. Хук использует тот же формат.

## 3. @claude

- `agent/pre-step` ловит последнюю user-реплику, если она начинается с `@claude`.
- В промт Claude: последние 15 реплик из session log.
- Ответ Claude вставляется в messages как `system`-блок:
  - `CLAUDE VERBATIM:` + ответ дословно;
  - инструкция DeepSeek: сначала процитировать, затем своё мнение.
- Один вызов на шаг, без рекурсии: маркер в решении/шаге.
- Если Claude ERROR/LIMIT — тот же блок со статусом, DeepSeek не выдумывает.
- Точный контракт `agent/pre-step` проверяется по `cordis_inspect_query` до кода.

## 4. Поля

`ask_claude` и `claude_review` возвращают:

```ts
{ ok: boolean, limited: boolean, resetAt: string | null, text: string }
```

`text` первая строка:

```text
STATUS: OK
STATUS: ERROR (...)
STATUS: LIMIT до <ISO>
```

Все числа через `Number.isFinite`, иначе `null` (cost и т.п.).

## 5. Rules

Единственный файл:

```text
docs/CLAUDE-RULES.md
```

Содержит роль, запрет записи, секреты, формат вердикта, требования к плану/диффу. В коде нет второй копии правил.

## Проверки

- `ask_claude` без `claudeBin` → ERROR, не fallback.
- `claude_review diff`: approval только при OK и неизменном хэше.
- `claude-review.mjs` — только wrapper.
- `@claude` не вызывает себя повторно.
- `@claude` с ERROR не теряет статус.
- поля ok/limited/resetAt, числа null.
- старый hook продолжает работать.
