# Запуск после перезагрузки

## Быстрый старт

Двойной клик:

```text
START-ALL.cmd
```

Он открывает:

1. Сервер Omika — окно `OMIKA · SERVER`.
2. Cloudflare Tunnel — окно `OMIKA · TUNNEL`, если есть `.cloudflare-tunnel.env`.
3. Telegram-бота — окно `OMIKA · TELEGRAM`, если есть `.telegram.env`.
4. Браузер: http://127.0.0.1:7801

Публичный адрес:

```text
https://game.okinamura.com
```

## Что должно быть запущено

### Сервер

```text
node src/server.ts
```

или:

```bat
start.cmd
```

Порт по умолчанию:

```text
127.0.0.1:7801
```

Проверка:

```bat
node scripts\dev.mjs status
```

Остановка/перезапуск:

```bat
node scripts\dev.mjs restart
```

### Telegram

Отдельное окно:

```bat
scripts\start-telegram.cmd
```

Нужен `.telegram.env` с токеном бота. Если файла нет — сервер и игра работают, но обращения из Telegram не принимаются.

### Картинки

Отдельный локальный Qwen-сервер в текущем `.env` не настроен: переменные `UNSLOTH_*` отсутствуют. Картинки идут через настроенный image-провайдер OpenRouter. Отдельно запускать нечего.

Если позже добавишь локальный GPU:

```text
UNSLOTH_API_KEY
UNSLOTH_BASE_URL
UNSLOTH_IMAGE_MODEL
```

тогда его нужно запускать до сервера Omika.

## Что сохраняется после перезагрузки

- кампании: `data/campaigns/`;
- изображения: `data/images/`;
- снапшоты: `data/snapshots.db`;
- поиск: `data/search.db`;
- трассы: `data/traces.db`;
- бэкапы: `data/backups/`;
- настройки агентов: `data/agents.json`;
- настройки картинок: `data/image-profile.json`.

Перезагрузка компьютера эти файлы не удаляет.

## Если порт занят

```bat
node scripts\dev.mjs status
node scripts\dev.mjs restart
```

Или закрой окно `OMIKA · SERVER` и запусти `START-ALL.cmd` снова.

## Если браузер показывает старую версию

Один раз обнови страницу с очисткой кэша:

```text
Ctrl + F5
```

PWA-кэш сейчас:

```text
omika-shell-v52
```

## Перед выключением

Достаточно закрыть окна сервера и Telegram. Незавершённый ход сохраняется в очереди и продолжится после запуска.
