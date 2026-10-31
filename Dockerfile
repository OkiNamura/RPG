# Omika — минимальный образ: Node 24, без зависимостей.
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7801

COPY package.json ./
COPY src ./src
COPY data/source ./data/source
COPY data/agents.json data/ai-settings.json data/art-selection.json data/art-tags.json \
     data/catalog.json data/content-catalog.json data/genre-catalog.json data/narrative-catalog.json \
     data/lorebook.json data/templates.json ./data/

RUN mkdir -p data/campaigns data/images data/traces

# Кампании, картинки и трейсы должны переживать перезапуск контейнера.
VOLUME ["/app/data"]

EXPOSE 7801

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7801/api/stats > /dev/null || exit 1

CMD ["node", "src/server.ts"]
