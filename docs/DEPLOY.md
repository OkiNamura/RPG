# Размещение Omika на хостинге

Omika — один Node-процесс без внешней БД. Состояние игр, ключи, картинки и
трейсы лежат в `data/`. Поэтому схема простая: **один контейнер + постоянный
диск + reverse proxy с HTTPS и паролем**.

## Что нужно

| Компонент | Минимум | Рекомендуется |
|---|---|---|
| VPS | 1 vCPU, 1 ГБ RAM | 2 vCPU, 2 ГБ RAM, 20 ГБ SSD |
| Node | 24 (умеет `.ts` из коробки) | Docker-образ 
ode:24-alpine` |
| Домен | не обязателен | да, для HTTPS |
| Диск | 5 ГБ | 20 ГБ под кампании и картинки |
| Ключ | `OPENROUTER_API_KEY` | отдельный ключ только для Omika |

Подойдут: обычный VPS (Timeweb, Hetzner, Aeza, Selectel), Fly.io, Railway,
Render — везде, где есть **постоянный диск**. Serverless (Vercel/Netlify
Functions) не подходит: там нетпостоянного диска и долгих SSE-запросов.

## Важно про безопасность

В приложении есть **вход по паролю**. Пока `OMIKA_PASSWORD` пуст, авторизация
выключена — так удобно локально, но **не для интернета**.

Для публичного сервера:

1. Задай `OMIKA_PASSWORD` в `.env` и `OMIKA_SESSION_SECRET` (длинная случайная
   строка).
2. Поставь reverse proxy с HTTPS (Caddy/nginx).
3. Держи `data/` вне публичного доступа.
4. Ограничь файрвол: открыты только 80/443.
5. Используй отдельный ключ OpenRouter с лимитом.
6. Дополнительно можно включить Basic Auth в Caddy — как второй слой.

Сессия — подписанная HttpOnly-cookie на 30 дней, `SameSite=Lax`; на HTTPS
автоматически ставится `Secure`. Вход: `/login`, выход: `/api/logout`.
На входе — одноразовая арифметическая капча (10 минут), не более 10 попыток
за 15 минут с одного IP.

## Вариант A: Docker + Caddy (рекомендуется)

На сервере:

```bash
git clone git@github.com:OkiNamura/RPG.git omika
cd omika
cp .env.example .env
nano .env            # OPENROUTER_API_KEY, OMIKA_PASSWORD, OMIKA_SESSION_SECRET
docker compose up -d --build
docker compose logs -f
```

`docker-compose.yml` слушает `127.0.0.1:7801` и хранит данные в томе
`omika-data`. Наружу выставляем только Caddy.

`Caddyfile`:

```caddyfile
game.okinamura.com {
    reverse_proxy 127.0.0.1:7801
}
```

Caddy сам получит сертификат Let's Encrypt. Вход в игру — через `/login`.

Проверка:

```bash
curl -I https://game.okinamura.com/          # 302 на /login без cookie
curl -X POST https://game.okinamura.com/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"твой-пароль"}'
```

### Обновление

```bash
git pull
docker compose up -d --build
```

### Бэкап

```bash
docker run --rm -v omika-data:/data -v "$PWD/backup:/backup" alpine \
  tar czf /backup/omika-$(date +%F).tgz -C /data .
```

Восстановление — распаковать в том же порядке. Перед обновлением делать бэкап
обязательно: формат кампаний может меняться.

## Вариант B: без Docker, systemd

```bash
# Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git

git clone git@github.com:OkiNamura/RPG.git /opt/omika
cd /opt/omika
cp .env.example .env && nano .env
```

`/etc/systemd/system/omika.service`:

```ini
[Unit]
Description=Omika
After=network.target

[Service]
WorkingDirectory=/opt/omika
Environment=HOST=127.0.0.1
Environment=PORT=7801
ExecStart=/usr/bin/node src/server.ts
Restart=always
User=omika
Group=omika

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now omika
```

Дальше — тот же Caddy/nginx перед `127.0.0.1:7801`.


## Вариант C: Cloudflare Tunnel (без VPS)

Tunnel не требует открытых портов и белого IP. Компьютер должен быть включён.

```bash
cloudflared tunnel run --token <TUNNEL_TOKEN>
```

В Cloudflare заранее:

- tunnel `omika`;
- public hostname `game.okinamura.com` → `http://127.0.0.1:7801`;
- DNS CNAME создаётся автоматически.

В репозитории есть `scripts/start-tunnel.cmd` — он читает токен из
`.cloudflare-tunnel.env` и запускает локальный `tools/cloudflared/cloudflared.exe`.

После запуска проверь:

```bash
curl -I https://game.okinamura.com/   # 302 на /login
```

Пароль игры — в `.admin-password` (файл в `.gitignore`).
## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `OPENROUTER_API_KEY` | — | ключ для ходов и картинок |
| `HOST` | `127.0.0.1` | `0.0.0.0` в контейнере |
| `PORT` | `7801` | порт приложения |
| `OMIKA_MODEL` | `deepseek/...` | модель ведущего |
| `OMIKA_PASSWORD` | — | пароль входа; пусто — авторизация выключена |
| `OMIKA_SESSION_SECRET` | из пароля | секрет подписи cookie |
| `OMIKA_SECURE_COOKIE` | авто | `true` принудительно включает Secure-cookie |
| `OMIKA_TRACE` | включено | `0` отключает трейсы |

Файл `.env` читается автоматически, в Docker — через `env_file`.

## Что проверить после деплоя

- без cookie `/api/stats` отвечает 401, `/` ведёт на `/login`;
- с верным паролем вход открывает игру;
- создаётся игра, проходит ход, приходит SSE-поток;
- картинка сохраняется в `data/images` и отдаётся по `/api/images/...`;
- после `docker compose restart` кампании на месте;
- неверный пароль не пускает, после 10 попыток — 429;
- в логах нет `EACCES` на `data/`.

## Ограничения текущей архитектуры

- **Один инстанс.** Кампании — JSON-файлы, снимки и сессии в памяти. Два
  контейнера на одном томе подерутся за файлы.
- **SSE держит соединение** — прокси должен не буферизовать ответ
  (`proxy_buffering off` в nginx; Caddy по умолчанию нормально).
- **Включён один пароль** на всю игру; отдельные пользователи не поддерживаются.
- **Трейсы растут** — чистить `data/traces` по расписанию или ставить
  `OMIKA_TRACE=0`.
- **Картинки** — самая дорогая часть; лимитируй через ключ и тариф.

## Фактические замеры

- Node-процесс: **~100–150 МБ RAM** в простое и на длинной кампании.
- Кампания на 50–80 ходов: **0.5–3.5 МБ** JSON (зависит от конспекта и снимков).
- Одна картинка: **150–300 КБ** JPEG.
- Исходники: ~0.5 МБ; Docker-образ ~150–200 МБ.
- 20 игроков по 50 ходов с 5 картинками: ~100–200 МБ данных, 1 ГБ RAM хватит.
- 100 игроков: 2 ГБ RAM, 40 ГБ SSD, бэкап раз в сутки.

## Ориентир по деньгам

- VPS 2 ГБ — ~300–600 ₽/мес.
- Домен — ~200–1000 ₽/год.
- OpenRouter — по факту: ход ~$0.003–0.005, картинка ~$0.01–0.04.
- 20 игроков по 50 ходов без картинок — примерно $3–5 суммарно.
