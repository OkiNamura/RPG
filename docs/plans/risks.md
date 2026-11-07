# Хвосты A–D: живая пара

1. Faction attitude drift
- `advanceFactionRelations` меняет `attitude` пар каждый тик:
  - рост фронта одной фракции на 20+ снижает отношение к ней на 1;
  - близкие отношения фракций к герою (разница <=20) дают +1.
- clamp, note war/union/перемирие по порогам.
- тест: attitude меняется от фронтов, затем война → перемирие.

2. npm test
- `test` = unit + memory + director + world + context-order.
- не менять отдельные test:*.

3. Director integration
- вынести `directorQuestion(directorText)` в core/director.ts.
- `afterTurn` передаёт `session.lastDirectorQuestion` в `updateSceneCheckpoint`.
- новая сцена получает question из последнего Director, иначе не заполняет.
- тест: regenerate/rollback condition + question.

4. question scene
- вопрос = первая строка Director с `?`, до 160 символов.
- нет Director — question не выдумывать.
