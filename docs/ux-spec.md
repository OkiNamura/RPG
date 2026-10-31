# UX/дизайн-спека — новые блоки OMIKA

Статус: черновик к внедрению. Документ описывает только интерфейс; код не меняется.
Область: экран игры `#/play/:id`, панель состояния, экран `#/new`.
Проверять на 1280×800, 1024×768, 390×844, 320×568; мышью, клавиатурой и с `prefers-reduced-motion`.

Что уже есть и от чего считаем:

- сайдбар 216px, карта — `#side-map` с `white-space: pre`, 7.6px, строкой + легенда из `core/dungeon.ts`;
- панель 318px, секции `.sect`, карточки `details.card` с `summary`;
- композер 44px, мобильный порог — 900px, панель на мобильном — шторка 45vh;
- диалог — `.overlay > .dialog` шириной 460px.

---

## 0. Общая рамка

### 0.1 Токены

Текущая палитра в `style.css` темнее и серее целевой. Заменить `:root` целиком:

```css
:root {
  /* палитра */
  --bg: #0c0c0f;
  --bg-deep: #08080a;
  --panel: #101013;
  --card: #141418;
  --line: #1f1f24;
  --line-soft: #1a1a1f;
  --text: #e8e4da;
  --text-soft: #cfc8ba;
  --muted: #8a857b;
  --dim: #5f5b53;
  --thought: #9d978c;
  --thought-fear: #b3a39c;

  --gold: #c9a961;
  --gold-dim: #8a7342;
  --gold-wash: rgba(201, 169, 97, 0.12);
  --blood: #a8402f;
  --blood-dim: #6e2b22;
  --blood-soft: #b06a5b;
  --blood-wash: rgba(168, 64, 47, 0.12);
  --ok: #6f8f5f;

  /* карта */
  --map-bg: #0b0b0d;
  --map-wall: #3a373f;
  --map-floor: #4d4942;

  /* шрифты */
  --serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
  --sans: "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "Cascadia Mono", Consolas, monospace;

  /* метрики */
  --sidebar-w: 240px;
  --panel-w: 318px;
  --pad-x: clamp(16px, 5vw, 74px);
  --pad-page: clamp(20px, 4vw, 46px);
  --r-s: 8px;
  --r-m: 12px;
  --tap: 44px;
}
```

Ключевые замены: `--bg #0a0a0c → #0c0c0f`, `--panel #141417 → #101013`, `--line #26262c → #1f1f24`, `--text #d9d4ca → #e8e4da`, `--muted #7b776f → #8a857b`, `--gold #c9a45c → #c9a961`, `--blood #a4483a → #a8402f`.
Фоновые радиальные градиенты `body` приглушить до `rgba(201,169,97,.04)` и `rgba(168,64,47,.03)`.

### 0.2 Сетка

| Что | Значение | Где |
|---|---|---|
| Сайдбар | 240px | `body { grid-template-columns: var(--sidebar-w) minmax(0,1fr) }` |
| Панель | 318px | `.play-body { grid-template-columns: minmax(0,1fr) var(--panel-w) }` |
| Мобильный порог | 900px | один столбец, панель — шторка |
| Композер | 44px | `.composer textarea` и кнопка отправки |
| Карта | 31×14 символов, 10px/10px | сайдбар, ширина 240px |
| Лента | проза 17.5px/1.8, `max-width: 72ch` | `.msg.gm .prose` |

Арифметика карты: 240 − 2×14 (padding сайдбара) = 212; минус margin 2×2 = 208; минус border 2 и padding 2×6 = 194. Строка 31 символ × 6px (0.6em у Cascadia Mono при 10px) = 186px. Запас 8px. Высота: 14×10 + padding 10 + border 2 = 152px.

### 0.3 Порядок вертикального стека игры

```text
.play
├─ .play-head
├─ .map-mobile        (только ≤900px, свёрнута)
├─ .play-body         (.log | .panel)
├─ .typing
├─ .place-cards
├─ .thoughts          (только когда есть мысль)
├─ .quick-actions
├─ .composer          (.dice-toggle внутри)
└─ .play-hint
```

### 0.4 Типографика и иконки

- Заголовки — Georgia, тело — Segoe UI, акценты и цифры — Cascadia Mono.
- Минимальный кегль — 9.5px, только для легенды и ролей; ниже не опускаемся.
- Иконки — текстовые глифы, не эмодзи: добавлять `\uFE0E` (`⚔︎`, `✦`), цвет только из токенов. Декоративные — `aria-hidden="true"`.
- Радиусы: 8px — кнопки и чипсы, 10px — карточки, 12px — плитки и диалоги.

---

## 1. Карта местности

### Где

- **Десктоп >900px:** сайдбар расширяется с 216 до 240px; карта живёт между `.nav` и `.side-foot`, один экземпляр `#side-map`.
- **Мобильный ≤900px:** сайдбар превращается в горизонтальное меню, карта туда не влезает. Карта живёт в `.map-mobile` сразу под `.play-head`, свёрнутая в `<details>`.
- В ленте и в панели карты нет. Модалок нет.

### Как выглядит

- Блок 212px шириной, без горизонтального скролла. Внутри: заголовок (место + ход), рамка карты, легенда.
- Заголовок: 10px моно, место обрезается эллипсисом, «ход 12» справа цветом `--dim`.
- Карта: 31×14, `font-size: 10px; line-height: 10px`, рамка `--line-soft`, фон `--map-bg`, padding 5px 6px, radius 6px, `user-select: none`.
- `<pre>` не подходит: цвет нужен по отдельным клеткам. Строки — `<div class="dmap-row">`, пробелы сохраняет `white-space: pre`.
- Символы и цвета:

| Символ | Класс | Цвет | Значение |
|---|---|---|---|
| `#` | `.mc-wall` | `--map-wall` | стена |
| `.` | `.mc-floor` | `--map-floor` | пол комнаты и коридора |
| `+` | `.mc-door` | `--gold-dim` | дверь |
| `@` | `.mc-hero` | `--gold` + заливка + свечение | герой |
| `$` | `.mc-gold` | `--gold` | золото |
| `*` | `.mc-item` | `--text-soft` | вещь |
| `!` | `.mc-find` | `--gold` | находка |
| `V` `W` `x` | `.mc-monster` | `--blood-soft`, вес 600 | тварь |

- `@` — золотой, жирный, с заливкой `--gold-wash`, тонкой рамкой `rgba(201,169,97,.22)` и `text-shadow: 0 0 6px rgba(201,169,97,.45)`. Клетка 6×10px, поэтому фон ложится ровно.
- Твари — единственные красные элементы карты; анимаций нет.
- Легенда: `<details>`; на десктопе при высоте окна ≥700px открыта, на мобильном и ниже 700px — свёрнута. Открытая — сетка 2 колонки, 9.5px, символы теми же цветами. Сводка — «легенда» золотым dim, 9.5px, uppercase.

### Разметка (классы)

```html
<section class="map-box" id="side-map" aria-label="Карта местности">
  <div class="map-head">
    <span class="map-title">Пепельный тракт</span>
    <span class="map-turn">ход 12</span>
  </div>

  <div class="dmap" role="img"
       aria-label="Карта: 6 комнат, ты в первой, справа тварь, впереди дверь">
    <div class="dmap-row"><span class="mc mc-wall">########</span><span class="mc mc-floor">...</span>…</div>
    …
  </div>

  <details class="map-legend" open>
    <summary>легенда</summary>
    <ul>
      <li><span class="mc mc-wall">#</span> стена</li>
      <li><span class="mc mc-floor">.</span> пол</li>
      <li><span class="mc mc-door">+</span> дверь</li>
      <li><span class="mc mc-hero">@</span> ты</li>
      <li><span class="mc mc-gold">$</span> золото</li>
      <li><span class="mc mc-item">*</span> вещь</li>
      <li><span class="mc mc-find">!</span> находка</li>
      <li><span class="mc mc-monster">V</span> тварь</li>
    </ul>
  </details>
</section>
```

Соседние одинаковые символы склеивать в один `<span>` (run-length): 31×14 при жадной склейке — обычно 60–120 узлов, а не 434.

На мобильном тот же блок живёт в `<details class="map-mobile" id="map-mobile">` с `summary` «карта · <место>» и теми же `.map-head`, `.dmap`, `.map-legend` внутри.

### CSS

```css
.map-box {
  margin: 14px 2px 0;
  padding-top: 10px;
  border-top: 1px solid var(--line-soft);
}
.map-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.map-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.map-turn { flex: 0 0 auto; color: var(--dim); }

.dmap {
  padding: 5px 6px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--map-bg);
  font-family: var(--mono);
  font-size: 10px;
  line-height: 10px;
  letter-spacing: 0;
  white-space: pre;
  color: var(--map-floor);
  overflow: hidden;
  user-select: none;
  font-variant-ligatures: none;
}
.dmap-row { height: 10px; }

.mc-wall { color: var(--map-wall); }
.mc-floor { color: var(--map-floor); }
.mc-door { color: var(--gold-dim); }
.mc-gold { color: var(--gold); }
.mc-item { color: var(--text-soft); }
.mc-find { color: var(--gold); }
.mc-monster { color: var(--blood-soft); font-weight: 600; }
.mc-hero {
  display: inline-block;
  width: 6px;
  height: 10px;
  line-height: 10px;
  text-align: center;
  vertical-align: top;
  color: var(--gold);
  font-weight: 700;
  background: var(--gold-wash);
  box-shadow: 0 0 0 1px rgba(201, 169, 97, 0.22);
  text-shadow: 0 0 6px rgba(201, 169, 97, 0.45);
}

.map-legend { margin-top: 5px; }
.map-legend summary {
  padding: 3px 0;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gold-dim);
  cursor: pointer;
  list-style: none;
}
.map-legend summary::-webkit-details-marker { display: none; }
.map-legend ul {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 8px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-family: var(--mono);
  font-size: 9.5px;
  line-height: 1.35;
  color: var(--muted);
}
```

### Поведение

- Старые правила `.side-map` (7.6px, `opacity: .95`, `overflow: hidden`) удалить — они конфликтуют с `.map-box`/`.dmap`. `#side-map` остаётся id-хуком, класс `.hidden` по-прежнему управляется роутером.
- Контракт: `map = { place, turn, rows: string[] }`, ровно 14 строк по 31 символу. Переходный вариант: `data.map` — строка; бери первые 14 строк до `\n\n`, легенду отбрось.
- Генератор — `core/dungeon.ts` на 31×14: 6–8 комнат, L-коридоры, двери `+`, 3–5 предметов (`$ * !`), 3–5 тварей (`V W x`), один `@`. Сид — место; вид не меняется между ходами без смены локации.
- Перестраивать карту только после `done` и только при смене `place` или `turn`; на обновление панели не реагировать.
- Рендерер принимает контейнер: при входе в игру заполняются оба (`#side-map` и `#map-mobile`), показывается нужный по media query. Не дублировать генерацию на ресайзе.
- Открытость легенды — `localStorage['omika.mapLegend']`, по умолчанию `false` при `innerHeight < 700`.
- Карта неинтерактивна: без `tabindex`, без кликов. Один `role="img"` с текстовым описанием (комнаты, где герой, сколько монстров).
- Если карта не пришла или строки битые — блок скрыть целиком, пустую рамку не показывать.
- Смена хода: 120ms `opacity` от .6 к 1, без сдвига layout.

### Мобильный

```css
.map-mobile { display: none; }

@media (max-width: 900px) {
  .map-box { display: none; }

  .map-mobile {
    display: block;
    border-bottom: 1px solid var(--line-soft);
    background: var(--bg);
  }
  .map-mobile > summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
    padding: 0 12px;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    cursor: pointer;
    list-style: none;
  }
  .map-mobile > summary::-webkit-details-marker { display: none; }
  .map-mobile .map-head { display: flex; padding: 0 12px 6px; }
  .map-mobile .dmap {
    width: max-content;
    max-width: calc(100% - 24px);
    margin: 0 auto 8px;
    font-size: 11px;
    line-height: 11px;
    overflow-x: auto;
  }
  .map-mobile .dmap-row { height: 11px; }
  .map-mobile .mc-hero {
    width: 6.6px;
    height: 11px;
    line-height: 11px;
  }
  .map-mobile .map-legend { margin: 0 12px 10px; }
}
```

- Свёрнутая строка 44px: «карта · Пепельный тракт» + счётчик комнат.
- Развёрнутая занимает не больше 30vh; при нехватке ширины — горизонтальный скролл, не сжатие шрифта.
- Открытость запоминается; после отправки хода карта не закрывается сама.

---

## 2. Мысли героя

### Где

- В игре: полоса `.thoughts` между `.place-cards` и `.quick-actions` — под лентой, над чипсами и вводом. Не в панели и не поверх ленты.
- В ленте не показывать: мысль — не реплика ведущего и не системное сообщение.
- Одна мысль за раз: последняя заменяет предыдущую, архив в панели — позже.

### Как выглядит

- Строка высотой около 30px (padding 5px + line-height 20px), ширина до 72ch, выровнена по левому краю текста ленты.
- Без фона и рамки; только линия 2px слева. Предчувствие — `--gold-dim` в 35% (`rgba(201,169,97,.35)`), страх — `--blood`.
- Иконка 14×14: `✦` цветом `--gold-dim` у предчувствия; `!` цветом `--blood` в круге 14px у страха.
- Текст: Georgia italic 13.5px/1.5, `--thought`; у страха — `--thought-fear`. Кавычек и подписи «мысль» нет.
- Свёрнуто — ровно одна строка с эллипсисом; клик разворачивает до трёх строк. Отдельной кнопки «развернуть» нет.
- Кнопка закрытия 20×20 (глиф `×`, 14px, `--dim`) появляется на hover/focus; на тач-устройствах видна всегда.
- Появление: 220ms `opacity` 0→1 и `translateY(2px)→0`, без изменения высоты.

### Разметка (классы)

```html
<aside class="thoughts" id="thoughts" aria-live="polite" aria-label="Мысль героя">
  <div class="thought kind-fear">
    <span class="th-icon" aria-hidden="true">!</span>
    <button type="button" class="th-text" aria-expanded="false">
      Если я обернусь, он уже будет стоять в дверях.
    </button>
    <button type="button" class="th-close" aria-label="Скрыть мысль">×</button>
  </div>
</aside>
```

### CSS

```css
.thoughts {
  flex: 0 0 auto;
  padding: 4px var(--pad-x) 0;
}
.thoughts:empty { display: none; }

.thought {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 72ch;
  padding: 5px 10px 5px 9px;
  border-left: 2px solid rgba(201, 169, 97, 0.35);
  font-family: var(--serif);
  font-size: 13.5px;
  font-style: italic;
  line-height: 1.5;
  color: var(--thought);
}
.thought.kind-fear {
  border-left-color: var(--blood);
  color: var(--thought-fear);
}

.th-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  font-family: var(--mono);
  font-size: 10px;
  font-style: normal;
  line-height: 1;
  color: var(--gold-dim);
}
.thought.kind-fear .th-icon {
  color: var(--blood);
  border: 1px solid rgba(168, 64, 47, 0.55);
  border-radius: 50%;
}

.th-text {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-style: italic;
  text-align: left;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}
.thought.open .th-text { -webkit-line-clamp: 3; }

.th-close {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.thought:hover .th-close,
.thought:focus-within .th-close { opacity: 1; }
.th-close:hover { color: var(--text); }

.thoughts:not(:empty) .thought {
  animation: thought-in 0.22s ease both;
}
@keyframes thought-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .thoughts:not(:empty) .thought { animation: none; }
}

@media (max-width: 900px) {
  .thoughts { padding: 4px 12px 0; }
  .thought { font-size: 13px; max-width: 100%; }
  .th-close { width: 28px; height: 28px; opacity: 1; }
}
@media (hover: none) {
  .th-close { opacity: 1; }
}
```

### Поведение

- Данные: `hero.intuition?: string` — уже есть в стейте, до 240 символов. Опционально `hero.intuitionKind?: 'hunch' | 'fear'`; без поля считаем предчувствием.
- Показывать, пока `hero.intuition` не пуст; новая строка заменяет прошлую, архив в панели — позже.
- Вставлять после `done` хода, не во время стрима. Мысль не резервирует высоту: пустой слот схлопывается, лента не перерисовывается и не прыгает.
- Клик по тексту переключает `.open` и `aria-expanded`; повторный клик сворачивает.
- `×` скрывает мысль до следующей. Ключ скрытия — текст мысли в `sessionStorage`, чтобы обновление панели не возвращало её.
- Не заполнять `.thoughts` через `textContent`: внутри живут иконка, кнопка-текст и кнопка закрытия.
- `aria-live="polite"` на слоте; при вставке текст зачитывается один раз. Фокус не перехватывается, автоскролла нет.
- Мысль не связана с броском d36 и не является результатом проверки: это атмосфера и подсказка.

### Мобильный

- Padding 12px, кегль 13px; `.thought` — `max-width: 100%`.
- `.th-close` 28×28 и всегда видима (`@media (hover: none)`).
- Развёрнутая мысль — до 3 строк; тексты длиннее 220 символов в свёрнутом виде всё равно одна строка.
- При открытой экранной клавиатуре полоса остаётся над чипсами и не перекрывает композер.

---

## 3. Кубик d36

### Где

- Галочка — в `.composer` справа от textarea, перед кнопкой отправки: 36×36 на десктопе, 44×44 на мобильном, выровнена по низу с полем.
- Результат — карточка броска в ленте: после реплики игрока и до прозы ведущего. Не тост, не панель и не тихая строка `.msg.system`.
- Один бросок за ход; галочка одноразовая и сбрасывается после ответа.

### Как выглядит

- Тумблер: квадрат 36×36, radius 9px, рамка `--line`, фон `#111114`, надпись `d36` моно 10.5px/600. Выключен — `--muted`; включён — `--gold` на золотом градиенте, рамка `--gold-dim`, внутренняя подсветка `rgba(201,169,97,.18)`. Иконку кубика не рисуем.
- Title: «Бросок d36 уйдёт вместе с ходом. 34–36 — джокер».
- Карточка броска: 260×56, по центру ленты, рамка `--line`, фон `--panel`, radius 10px. Слева число 32px моно; справа две строки: «БРОСОК d36» (10px, uppercase, `--muted`) и причина/исход 12px (`--text-soft`).
- Обычный бросок (1–33): число `--text`, карточка нейтральная.
- Джокеры: 34 — «джокер удачи», 35 — «джокер судьбы», 36 — «джокер бездны». 34 и 35 — золотая карточка; 36 — кровь: рамка `--blood-dim`, число `--blood-soft`, фон с `--blood-wash`. Подпись всегда в `.roll-note`. Это единственное цветовое различие между джокерами.
- Число — `font-variant-numeric: tabular-nums`, не «прыгает» при смене значения.

### Разметка (классы)

```html
<label class="dice-toggle" title="Бросок d36 уйдёт вместе с ходом. 34–36 — джокер">
  <input type="checkbox" id="dice" aria-label="Добавить бросок d36 к ходу" />
  <span class="dice-face" aria-hidden="true">d36</span>
</label>
```

```html
<article class="msg roll joker" data-face="36" aria-label="Бросок d36: 36, джокер бездны">
  <div class="roll-card">
    <span class="roll-num">36</span>
    <div class="roll-meta">
      <span class="roll-kind">бросок d36</span>
      <span class="roll-note">Ловкость · джокер бездны</span>
    </div>
  </div>
</article>
```

### CSS

```css
.dice-toggle {
  position: relative;
  display: block;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  margin-bottom: 4px;
  padding: 0;
  cursor: pointer;
}
.dice-toggle input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.dice-face {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #111114;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  pointer-events: none;
  transition: border-color 0.15s, color 0.15s, background 0.15s, box-shadow 0.15s;
}
.dice-toggle:hover .dice-face {
  border-color: var(--gold-dim);
  color: var(--text);
}
.dice-toggle input:checked + .dice-face {
  color: var(--gold);
  border-color: var(--gold-dim);
  background: linear-gradient(180deg, #241d13, #1a150e);
  box-shadow: inset 0 0 0 1px rgba(201, 169, 97, 0.18);
}
.dice-toggle input:focus-visible + .dice-face {
  outline: 2px solid var(--gold-dim);
  outline-offset: 2px;
}
.dice-toggle input:disabled + .dice-face {
  opacity: 0.4;
  cursor: default;
}

.msg.roll {
  display: flex;
  justify-content: center;
  margin: 0 0 20px;
}
.roll-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 260px;
  max-width: 100%;
  padding: 11px 14px 11px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.roll-num {
  min-width: 48px;
  text-align: center;
  font-family: var(--mono);
  font-size: 32px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.roll-meta { display: flex; flex-direction: column; gap: 2px; }
.roll-kind {
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.roll-note { font-size: 12px; color: var(--text-soft); }

.msg.roll.joker .roll-card {
  border-color: #4a3a1e;
  background:
    radial-gradient(120px 60px at 18% 50%, var(--gold-wash), transparent 70%),
    #12100b;
  animation: joker-in 0.22s ease-out both;
}
.msg.roll.joker .roll-num {
  font-size: 36px;
  color: var(--gold);
  text-shadow: 0 0 12px rgba(201, 169, 97, 0.35);
}
.msg.roll.joker .roll-kind { color: var(--gold); }

.msg.roll.joker[data-face="36"] .roll-card {
  border-color: var(--blood-dim);
  background:
    radial-gradient(120px 60px at 18% 50%, var(--blood-wash), transparent 70%),
    #140d0c;
}
.msg.roll.joker[data-face="36"] .roll-num {
  color: var(--blood-soft);
  text-shadow: 0 0 12px rgba(168, 64, 47, 0.35);
}
.msg.roll.joker[data-face="36"] .roll-kind { color: var(--blood); }

@keyframes joker-in {
  from { transform: scale(0.96); }
  to { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .msg.roll.joker .roll-card { animation: none; }
}
```

### Поведение

- Источник случайности — только сервер: `rollD36` из `core/dice.ts`, клиент не бросает, иначе результат разойдётся с состоянием.
- Submit: если галочка стоит, в тело хода уходит `dice: true`. На время запроса чекбокс `disabled`; после `done` или ошибки снимается.
- Формат результата: `{ face: 1..36, joker: boolean, label: string }`, как в `Roll`. Сервер отдаёт его SSE-событием `roll` **до** первого `delta`; если пока отдаёт в `done`, клиент вставляет карточку перед `.msg.gm` этого хода.
- Клиент вставляет карточку после последней `.msg.player` и до плейсхолдера ответа ведущего.
- Если события нет (скрытая проверка) — карточки нет, ошибки не показывать.
- 34–36 добавляют класс `.joker`; подпись берётся из `label` («джокер удачи / судьбы / бездны»).
- Для истории: писать `roll` в `turn.roll`; при перезагрузке ленты рендерить карточку между репликой игрока и ответом ведущего.
- Скрытая проверка: сервер не отправляет `roll`, в карточке нет ни числа, ни названия навыка. Последствие — только в прозе и в изменениях панели (см. блок 5).
- Клавиатура: Space/Enter на чекбоксе переключает; Enter в textarea по-прежнему отправляет ход.
- Ошибка запроса: чекбокс вернуть в прежнее состояние, карточку не показывать, тост с текстом ошибки.

### Мобильный

```css
@media (max-width: 900px) {
  .dice-toggle { width: 44px; height: 44px; margin-bottom: 0; }
  .dice-face { font-size: 11px; }
  .roll-card { width: 100%; max-width: 300px; }
  .roll-num { font-size: 28px; min-width: 42px; }
  .msg.roll.joker .roll-num { font-size: 32px; }
}
```

- Галочка остаётся справа у поля, композер не переносит её на новую строку: 44 + 44 + 2×10 = 108px, textarea получает остаток.
- Карточка броска — на всю ширину до 300px, по центру; тап по ней ничего не делает.

---

## 4. Карточки фракций

### Где

- В панели состояния, секция «Фракции» — на месте текущего списка `.list`, после «Долги и крючки».
- Одна фракция — один `details.fcard`, свёрнутый по умолчанию. Шапка 30px, раскрытое тело — 3–6 строк.
- Если у фракции нет состава, оставить текущую простую строку `.row` без `details`.

### Как выглядит

- Свёрнутая шапка: шеврон `▸`, имя 13px (обрезается), чип отношения, счётчик скрытых. Высота 30px, padding 6px 10px.
- Отношение: моно 10.5px, чип 3px 5px, radius 5px. Положительное — `--gold` и рамка `#3a3020`; отрицательное — `--blood-soft` и `#3a2420`; ноль — `--dim`.
- Скрытые: `+2` (9.5px моно, `--dim`) в шапке — это `roster.filter(p => p.hidden).length`; `title="2 скрытых в составе"`. Имена скрытых не уходят на клиент, если неизвестны.
- Тело: строки-роли сеткой 86px / 1fr / auto, высота 26px, разделитель — пунктир `--line-soft`.
  - «глава» — `leader`, если известен;
  - «серый кардинал» — `shadow`, если известен;
  - «состав» — до 4 известных: `имя — роль`; больше — «ещё N» в конце.
- Скрытые в составе: `hidden: true` даёт строку «скрыто» + число с тегом «не раскрыто»; отдельное имя не показываем, пока сервер его не раскрыл.
- Роль: 9.5px моно, uppercase, `--dim`. Значение: 12.5px, `--text-soft`. Скрытое — курсив, `--dim`, тег «скрыт» золотым dim на рамке `#33291c`.
- Примечание — Georgia italic 11.5px/1.4 `--muted`, максимум 2 строки.

### Разметка (классы)

```html
<details class="fcard">
  <summary>
    <span class="f-name">Гильдия пепла</span>
    <span class="f-att neg" aria-label="отношение минус 12">−12</span>
    <span class="f-hidden-count" title="2 скрытых в составе">+2</span>
  </summary>
  <div class="fcard-body">
    <ul class="f-roles">
      <li class="f-role">
        <span class="f-k">глава</span>
        <span class="f-v">Вейл Орм</span>
      </li>
      <li class="f-role">
        <span class="f-k">серый кардинал</span>
        <span class="f-v">писарь Верн</span>
      </li>
      <li class="f-role">
        <span class="f-k">состав</span>
        <span class="f-v">Марта — казначей; Клык — вышибала</span>
      </li>
      <li class="f-role is-hidden">
        <span class="f-k">скрыто</span>
        <span class="f-v">2</span>
        <span class="f-tag">не раскрыто</span>
      </li>
    </ul>
    <p class="f-note">Берут пошлину с моста; помнят старый долг.</p>
  </div>
</details>
```

Схема данных — соответствует `Faction` в `core/state.ts`:

```ts
interface Faction {
  name: string;
  attitude: number; // -100..100
  note?: string;
  leader?: string;
  shadow?: string;
  roster?: { name: string; role: string; note?: string; hidden?: boolean }[];
}
```

### CSS

```css
.fcard {
  margin-bottom: 6px;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  background: var(--panel);
  overflow: hidden;
}
.fcard > summary {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 6px 10px;
  list-style: none;
  cursor: pointer;
  font-size: 13px;
}
.fcard > summary::-webkit-details-marker { display: none; }
.fcard > summary::before {
  content: "▸";
  flex: 0 0 auto;
  color: var(--dim);
  font-size: 10px;
  transition: transform 0.15s;
}
.fcard[open] > summary::before { transform: rotate(90deg); }

.f-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-soft);
  font-weight: 500;
}
.f-att {
  margin-left: auto;
  padding: 3px 5px;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.f-att.pos { color: var(--gold); border-color: #3a3020; }
.f-att.neg { color: var(--blood-soft); border-color: #3a2420; }
.f-hidden-count {
  flex: 0 0 auto;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
}

.fcard-body {
  padding: 2px 10px 9px;
  border-top: 1px dashed var(--line-soft);
}
.f-roles { margin: 0; padding: 0; list-style: none; }
.f-role {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--line-soft);
  font-size: 12.5px;
  line-height: 1.4;
}
.f-role:last-child { border-bottom: none; }
.f-k {
  font-family: var(--mono);
  font-size: 9.5px;
  line-height: 1.3;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
}
.f-v {
  color: var(--text-soft);
  overflow-wrap: anywhere;
}
.f-role.is-hidden .f-v {
  color: var(--dim);
  font-style: italic;
}
.f-tag {
  padding: 2px 6px;
  border: 1px solid #33291c;
  border-radius: 999px;
  color: var(--gold-dim);
  font-family: var(--mono);
  font-size: 9.5px;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}
.f-note {
  margin: 6px 0 0;
  font-family: var(--serif);
  font-size: 11.5px;
  font-style: italic;
  line-height: 1.4;
  color: var(--muted);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
```

### Поведение

- Клиент получает только те данные, которые герой может знать. Неизвестные `leader`/`shadow` сервер просто не присылает; подставлять имя из `note` нельзя.
- Несколько карточек могут быть открыты одновременно; состояние не сохраняется между перезагрузками.
- Порядок — как в `state.factions`, без сортировки. Секцию не сворачиваем.
- После хода панель перерисовывается; если карточка была открыта, попытаться сохранить открытость по имени фракции (dataset), иначе — закрыть.
- `summary` — нативная кнопка `details`: Enter/Space работают, фокус видимый (обводка `--gold-dim`).
- При пустом `roster` и отсутствии `leader`/`shadow` — не показывать пустые строки; остаётся только шапка и примечание.
- Отношение и состав не редактируются в UI; изменения — только через ход.

### Мобильный

- Панель — шторка 45vh; `.fcard > summary` min-height 40px, имя 13.5px.
- Роли: `grid-template-columns: 78px minmax(0, 1fr) auto`, значение 12px, `f-k` 10px.
- Примечание — 2 строки; полный текст доступен через `title`.
- Счётчик скрытых остаётся в шапке, чтобы не открывать карточку ради этой цифры.

---

## 5. Скиллы в карточках персонажей

### Где

- В панели: в `.card-body` карточек пати и знакомых — сразу после портретов/кнопок и до строк «Внешность/Характер».
- У героя: в секции «Тело», под полосой здоровья и до ран/состояний.
- Не в шапке карточки: свёрнутая карточка остаётся однострочной.

### Как выглядит

- Одна строка (при нехватке ширины — две-три) моно 11px/1.6: `Сила 8 · Ловкость 14 · Скрытность 6 · Воля 9 · Восприятие 11 · Красноречие 7 · Знание 10 · Выживание 5`.
- Подпись скилла — `--muted` 10.5px, число — `--text-soft`, разделитель `·` — `--dim` с отступами 5px.
- Фиксированный порядок — `SKILL_NAMES` из `core/skills.ts`: Сила, Ловкость, Скрытность, Воля, Восприятие, Красноречие, Знание, Выживание. Пропущенные скиллы не рендерятся.
- Диапазон 0–20. Сильный (≥14) — число `--gold`; слабый (≤5) — `--blood-soft`. Промежуточные — без цвета.
- Никаких полос, иконок и тултипов: строка не должна спорить с полосой здоровья.
- Снизу — пунктир `--line-soft`, отделяющий скиллы от текстовых полей.

### Разметка (классы)

```html
<div class="skills-line" role="group"
     aria-label="Сила 8, Ловкость 14, Скрытность 6, Воля 9, Восприятие 11, Красноречие 7, Знание 10, Выживание 5">
  <span class="skill"><span class="sk-k">Сила</span><span class="sk-v">8</span></span>
  <span class="skill is-strong"><span class="sk-k">Ловкость</span><span class="sk-v">14</span></span>
  <span class="skill"><span class="sk-k">Скрытность</span><span class="sk-v">6</span></span>
  <span class="skill"><span class="sk-k">Воля</span><span class="sk-v">9</span></span>
  <span class="skill"><span class="sk-k">Восприятие</span><span class="sk-v">11</span></span>
  <span class="skill"><span class="sk-k">Красноречие</span><span class="sk-v">7</span></span>
  <span class="skill"><span class="sk-k">Знание</span><span class="sk-v">10</span></span>
  <span class="skill is-weak"><span class="sk-k">Выживание</span><span class="sk-v">5</span></span>
</div>
```

Схема данных (у `Actor` и у `hero`):

```ts
type SkillName =
  | 'Сила' | 'Ловкость' | 'Скрытность' | 'Воля'
  | 'Восприятие' | 'Красноречие' | 'Знание' | 'Выживание';

skills?: Partial<Record<SkillName, number>>; // 0..20
```

### CSS

```css
.skills-line {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 0;
  padding: 2px 0 7px;
  margin-bottom: 6px;
  border-bottom: 1px dashed var(--line-soft);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-soft);
}
.skill { white-space: nowrap; }
.skill:not(:last-child)::after {
  content: "·";
  margin: 0 5px;
  color: var(--dim);
}
.sk-k {
  margin-right: 3px;
  font-size: 10.5px;
  color: var(--muted);
}
.sk-v { font-variant-numeric: tabular-nums; }
.skill.is-strong .sk-v { color: var(--gold); }
.skill.is-weak .sk-v { color: var(--blood-soft); }
```

Для героя — тот же `.skills-line`, но без `margin-bottom`, сразу под `.bar` здоровья.

### Поведение

- Значения приходят из состояния и не пересчитываются на клиенте; редактирования в UI нет.
- Порог 14/5 — только визуальный маркер, не правило броска.
- **Скрытая проверка:** `hiddenCheck` в `core/skills.ts` возвращает `told`, но UI не показывает ни бросок, ни число. В ленте — только последствие в прозе («плечо прострелило», «шаг за спиной стих»), в панели — только механическое следствие (рана, потерянная вещь, новая задача).
- **Видимая проверка:** обычная карточка `.msg.roll`; в `.roll-note` — «Ловкость · бросок 14» и исход. Это единственный случай, когда бросок связан со скиллом в тексте.
- Если последствие никак не наблюдаемо, скрытую проверку не бросать: игрок не должен видеть «пустой» результат.
- Скиллы не влияют на цвет или размер карточки; после изменения состояния строка обновляется вместе с панелью.
- При отсутствии `skills` (старые сохранения) блок не рендерится, пустой строки нет.

### Мобильный

- Панель — шторка; `.skills-line` 11.5px/1.7, перенос на 2–3 строки допустим.
- В карточке героя строка идёт под полосой здоровья с отступом 4px.
- Никакого горизонтального скролла: только перенос.

---

## 6. Экран «Новая игра»

### Где

- `#/new`, мастер из четырёх шагов. Меняем два шага и добавляем быстрые действия:
  - шаг 3 «Герой» — плитка шаблонов в 3 колонки вместо пустой формы;
  - шаг 2 «Мир» — поле «свой мир» с счётчиком и примерами;
  - под заголовком страницы — `.new-quick`;
  - шаг 4 «Сборка» — липкая `.start-bar` вместо кнопки в теле.
- Сетка шаблонов — максимум 880px, как `.wizard`. Странице мастера — класс `.new-page`.

### Как выглядит

- Шаблоны убраны: шаг героя — только форма. Блок плиток и `/api/templates` удалены.
- В плитке: глиф — первая буква имени, 22px Georgia `--gold`; имя 15px; эпитет — `essence`, обрезанный до 70 символов, 11.5px `--muted`; 2 чипа с сильнейшими скиллами шаблона (`Сила 14`, `Воля 12`).
- Hover: рамка `#3a3325`, `translateY(-2px)`. Выбрана: рамка `--gold-dim`, заливка `linear-gradient(160deg, var(--gold-wash), transparent 62%)`, галочка 18px в круге `--gold` справа сверху.
- «Свой герой»: последняя плитка на всю ширину, 56px, пунктирная рамка, глиф `＋` и подпись по центру.
- Под сеткой всегда поле «Имя героя» (1–24 символа) и поля героя. Для пресета они заполнены; «Свой герой» просто снимает выбор, оставляя значения редактируемыми.
- Поле мира: textarea min-height 160px, max 1200 символов, рамка `--line`, фон `#0e0e11`, radius 10px, 14px/1.55. Счётчик справа снизу 10px моно `--dim`, после 1100 символов — `--gold`.
- Под полем — 3 примера (чипа) и подсказка: «Пусто — соберу тёмное фэнтези по умолчанию».
- `.new-quick` — ряд `.btn.small`: «Продолжить последнюю» (если есть кампании), «Импорт карточки V2», «Случайный герой».
- `.start-bar`: sticky снизу, 56px, фон `--bg` на 94%, blur 6px, верхняя линия `--line-soft`. Слева сводка 11px `--dim`, справа primary «Собрать историю».

### Разметка (классы)

Ниже блоки показаны подряд; в мастере они живут на своих шагах (2, 3 и 4).

```html
<div class="new-quick" role="group" aria-label="Быстрые действия">
  <button class="btn small" id="resume-last">Продолжить последнюю</button>
  <button class="btn small" data-open-import data-import-mode="hero">Импорт карточки V2</button>
  <button class="btn small" id="random-hero">Случайный герой</button>
</div>

<div class="template-grid" role="group" aria-label="Шаблон героя">
  <button type="button" class="template-tile" aria-pressed="true">
    <span class="ht-glyph" aria-hidden="true">В</span>
    <span class="ht-name">Воин-ветеран</span>
    <span class="ht-epithet">вернулся живым и не понимает, зачем</span>
    <span class="chips"><span class="chip">Сила 14</span><span class="chip">Воля 12</span></span>
  </button>
  <button type="button" class="template-tile">…</button>
  <button type="button" class="template-tile own">
    <span class="ht-glyph" aria-hidden="true">＋</span>
    <span class="ht-name">Свой герой</span>
    <span class="ht-epithet">собрать вручную</span>
  </button>
</div>

<div class="field hero-name">
  <label for="hero-name">Имя героя</label>
  <input id="hero-name" maxlength="24" placeholder="как тебя зовут" />
</div>

<div class="field world-field">
  <label for="world">Свой мир</label>
  <textarea id="world" class="world-custom" rows="5" maxlength="1200"
    placeholder="Устройство, фракции, экономика, угрозы…"></textarea>
  <div class="world-meta">
    <span class="world-hint">Пусто — соберу тёмное фэнтези по умолчанию</span>
    <span class="world-count">0 / 1200</span>
  </div>
  <div class="world-examples">
    <button type="button" class="chip">пепельные земли</button>
    <button type="button" class="chip">город под дождём</button>
    <button type="button" class="chip">остров мёртвых</button>
  </div>
</div>

<div class="start-bar">
  <span class="sb-hint">Воин-ветеран · «Пепельный тракт» · 3 тега</span>
  <button class="btn primary" id="build-story">Собрать историю</button>
</div>
```

### CSS

```css
.new-page { padding-bottom: 96px; }

.new-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  max-width: 880px;
  margin-bottom: 18px;
}
.template-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 132px;
  padding: 14px 14px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--card);
  color: var(--text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s, transform 0.18s, background 0.18s;
}
.template-tile:hover {
  border-color: #3a3325;
  transform: translateY(-2px);
}
.template-tile[aria-pressed="true"] {
  border-color: var(--gold-dim);
  background:
    linear-gradient(160deg, var(--gold-wash), transparent 62%),
    var(--card);
}
.template-tile[aria-pressed="true"]::after {
  content: "✓";
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--gold);
  color: #0c0c0f;
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1;
}
.template-tile:focus-visible {
  outline: 2px solid var(--gold-dim);
  outline-offset: 2px;
}

.ht-glyph {
  font-family: var(--serif);
  font-size: 22px;
  line-height: 1;
  color: var(--gold);
}
.ht-name { font-size: 15px; font-weight: 500; }
.ht-epithet {
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--muted);
}
.template-tile .chips { margin-top: auto; padding-top: 8px; }

.template-tile.own {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 56px;
  border-style: dashed;
  text-align: center;
}
.template-tile.own .ht-glyph { color: var(--gold-dim); font-size: 20px; }

.hero-name { max-width: 420px; margin-bottom: 18px; }

.world-field { max-width: 720px; }
.world-field .world-custom {
  min-height: 160px;
  font-size: 14px;
  line-height: 1.55;
}
.world-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--dim);
}
.world-count {
  flex: 0 0 auto;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.world-count.is-near { color: var(--gold); }
.world-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.world-examples .chip {
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}
.world-examples .chip:hover {
  color: var(--gold);
  border-color: var(--gold-dim);
}

.start-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  margin-top: 24px;
  padding: 12px 0;
  border-top: 1px solid var(--line-soft);
  background: linear-gradient(180deg, rgba(12, 12, 15, 0), rgba(12, 12, 15, 0.94) 34%);
  backdrop-filter: blur(6px);
}
.start-bar .btn:disabled { opacity: 0.4; cursor: default; }
.sb-hint {
  margin-right: auto;
  font-size: 11px;
  color: var(--dim);
}
```

### Поведение

- Шаблон задаёт `essence`, `appearance`, `bodyAttitude`, `origin`, `quirks`, `abilities`, `start`, `skills`; имя героя не подставляется — его вводит игрок. Переключение шаблона не стирает введённое имя.
- `.template-tile` — кнопки с `aria-pressed`; выбран ровно один. Клик по «Свой герой» снимает выбор с пресета и оставляет текущие поля редактируемыми.
- «Случайный герой» убран вместе с шаблонами.
- «Собрать историю» активна, когда есть имя (1–24 символа). Если имя пустое — disabled, в `.sb-hint` причина «укажи имя героя».
- Шаг 4: кнопка создания переезжает в `.start-bar`; инлайн-кнопку убрать. Статус сборки («Собираю тон…», «Собираю мир…») показывать в `.sb-hint`.
- Поле мира: `maxlength=1200`, счётчик обновляется на `input`; после 1100 — класс `.is-near`. Пример-чип заполняет поле, но только после подтверждения, если текст уже есть.
- Черновик мастера — в `sessionStorage['omika.newDraft']`; очищается после успешного создания.
- «Продолжить последнюю» ведёт в `#/play/:id` последней кампании; если кампаний нет — кнопка скрыта.
- «Импорт карточки V2» открывает диалог из блока 8 и после успеха остаётся на шаге 3 с выбранным «Свой герой».

### Мобильный

```css
@media (max-width: 900px) {
  .template-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .start-bar { flex-wrap: wrap; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .start-bar .sb-hint { flex-basis: 100%; order: -1; }
  .start-bar .btn.primary { flex: 1 1 100%; justify-content: center; }
}
@media (max-width: 480px) {
  .template-grid { grid-template-columns: 1fr; }
  .template-tile { min-height: 112px; }
  .world-field .world-custom { min-height: 120px; }
}
```

- 480–760px — 2 колонки, ниже 480px — одна; плитки не сжимаются в нечитаемые.
- `.start-bar` переносит сводку наверх, primary — на всю ширину; `env(safe-area-inset-bottom)` в padding.
- Поле мира не автоскроллится при фокусе; страница остаётся на месте.

---

## 7. Быстрые действия в ленте

### Где

- Полоса `.quick-actions` между `.thoughts` и `.composer`, выровнена по `--pad-x`. Это последний блок перед вводом.
- 3 базовых чипа: «Осмотреться», «Идти», «Говорить»; четвёртый — «Слушать» (контекст: есть что слушать).
- Над чипами остаются карточки места и мысль; под чипами сразу textarea.

### Как выглядит

- Высота 26px (мобильный — 32px), padding 0 11px, radius 999px, рамка `--line`, фон прозрачный.
- Текст 12px (мобильный 12.5px), `--muted`; hover — `--text` и рамка `--gold-dim`, фон `--gold-wash` в 50%.
- Нажатие: `translateY(1px)`, без «прыжка» layout.
- 3–4 чипа влезают в одну строку на 390px; при переполнении — горизонтальный скролл без видимого скроллбара, не перенос.
- Контекстный чип: «Слушать», если в сцене есть звук/за дверью; иначе не показывать. Не дублировать базовые.
- Чипы не выглядят как primary-кнопки: без заливки и без золотого текста в покое.

### Разметка (классы)

```html
<div class="quick-actions" role="group" aria-label="Быстрые действия">
  <button type="button" class="chip quick" data-fill="Осмотреться">Осмотреться</button>
  <button type="button" class="chip quick" data-fill="Идти к ">Идти</button>
  <button type="button" class="chip quick" data-fill="Говорить с Мартой">Говорить</button>
  <button type="button" class="chip quick" data-fill="Слушать">Слушать</button>
</div>
```

### CSS

```css
.quick-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 6px;
  padding: 8px var(--pad-x) 0;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.quick-actions::-webkit-scrollbar { display: none; }

.chip.quick {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s, transform 0.08s;
}
.chip.quick:hover {
  color: var(--text);
  border-color: var(--gold-dim);
  background: rgba(201, 169, 97, 0.06);
}
.chip.quick:active { transform: translateY(1px); }
.chip.quick:focus-visible {
  outline: 2px solid var(--gold-dim);
  outline-offset: 2px;
}
.chip.quick:disabled { opacity: 0.4; cursor: default; }
```

### Поведение

- Клик **вставляет** текст в поле, но не отправляет ход. Это защита от случайного тапа и способ дописать цель.
- Значения: «Осмотреться»; «Идти к » (с пробелом, каретка после); «Говорить с …» — если в сцене ровно один NPC, имя подставляется, иначе остаётся «Говорить с »; контекстный — «Слушать».
- Вставка: если поле не пустое, добавить один пробел; каретка в конец; вызвать `input` для авто-высоты; вернуть фокус в textarea.
- Полоса пересобирается после `done` и при смене сцены. Набор стабилен в пределах хода.
- Пока `app.game.busy` — все чипсы `disabled`. После ошибки хода — снова активны.
- Если `log` пуст (новый экран), чипсы всё равно видны: «Осмотреться» — валидный первый ход.
- `title="вставить в поле ввода"`; `aria-label` у полосы. Чипсы не съедают Enter и не перехватывают горячие клавиши.

### Мобильный

```css
@media (max-width: 900px) {
  .quick-actions { padding: 8px 12px 0; }
  .chip.quick { height: 32px; padding: 0 12px; font-size: 12.5px; }
}
```

- Горизонтальный свайп вместо переноса; правый край не обрезается padding'ом — последний чипс доскролливается.
- Высота 32px — компромисс между 44px тапа и теснотой композера; чипсы вторичны, основной ввод — textarea.
- При открытой клавиатуре полоса не скрывается, но и не липнет к клавиатуре: остаётся в потоке над композером.

---

## 8. Импорт карточки V2

### Где

- Кнопка «Импорт карточки V2» — в `.new-quick` на `#/new` (режим «герой»); в шапке игры — иконка `⤒` (режим «знакомый»); дубль — в шапке «Истории».
- Диалог — поверх страницы, по центру на десктопе, шторка снизу на мобильном.
- Файл выбирается нативным `input[type=file]`; кастомный drag&drop — только дополнение.
- Режим влияет только на то, куда попадут поля после подтверждения; разметка диалога одна.

### Как выглядит

- Диалог 520px, max-height 86dvh, padding 24px, radius 14px, рамка `--line`, фон `#131316`, тень как у текущего `.dialog`.
- Заголовок «Импорт карточки», подзаголовок: «JSON из SillyTavern или PNG со вшитой карточкой. Формат V2, до 5 МБ».
- Зона файла: 136px, пунктир `#3a3325`, radius 10px, фон `#0e0e11`, по центру: глиф `⤒` 20px `--gold-dim`, строка «Перетащи файл или нажми» 13.5px, строка «.json · .png · до 5 МБ» 11px `--dim`.
- Drag-over: рамка `--gold-dim`, фон `#12100b`, лёгкое свечение внутрь.
- Превью: строка 64px, аватар 40px с первой буквой имени, имя 14px, мета «V2 · 7 полей · 2 КБ» 10px моно, описание в 2 строки 12px; справа текстовая кнопка «заменить».
- Кнопки: «Отмена» ghost, «Использовать» primary; primary disabled до валидного файла.
- Ошибка — в существующем `.dialog-error` 12px `--blood`, без тоста и без тряски.

### Разметка (классы)

```html
<button class="btn small" data-open-import data-import-mode="hero">Импорт карточки V2</button>

<div class="overlay hidden" id="import-overlay">
  <div class="dialog import-dialog" role="dialog" aria-modal="true"
       aria-labelledby="import-title">
    <h2 id="import-title">Импорт карточки</h2>
    <p class="dialog-sub">
      JSON из SillyTavern или PNG со вшитой карточкой. Формат V2, до 5 МБ.
    </p>

    <label class="dropzone" id="dropzone">
      <input type="file" id="card-file" class="visually-hidden"
             accept=".json,.png,application/json,image/png" />
      <span class="dz-icon" aria-hidden="true">⤒</span>
      <span class="dz-main">Перетащи файл или нажми</span>
      <span class="dz-sub">.json · .png · до 5 МБ</span>
    </label>

    <div class="import-preview hidden" id="import-preview">
      <div class="ip-avatar" aria-hidden="true">В</div>
      <div class="ip-main">
        <b class="ip-name">Вейл Орм</b>
        <span class="ip-meta">V2 · 7 полей · 2 КБ</span>
        <p class="ip-excerpt">Наёмник без знамени. Помнит долг, которого не брал…</p>
      </div>
      <button type="button" class="ip-change">заменить</button>
    </div>

    <div class="dialog-error" id="import-error" role="alert"></div>

    <div class="dialog-actions">
      <button type="button" class="ghost" data-close>Отмена</button>
      <button type="button" class="primary" id="import-confirm" disabled>Использовать</button>
    </div>
  </div>
</div>
```

### CSS

```css
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.import-dialog {
  width: min(520px, 100%);
  max-height: 86dvh;
  padding: 24px;
  overflow-y: auto;
}

body.no-scroll { overflow: hidden; }
body.no-scroll .page,
body.no-scroll .log { overflow: hidden; }

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 136px;
  padding: 18px;
  border: 1px dashed #3a3325;
  border-radius: 10px;
  background: #0e0e11;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.dropzone:hover,
.dropzone:focus-within,
.dropzone.is-over {
  border-color: var(--gold-dim);
  background: #12100b;
  box-shadow: inset 0 0 0 1px rgba(201, 169, 97, 0.12);
}
.dropzone:focus-within {
  outline: 2px solid var(--gold-dim);
  outline-offset: 2px;
}
.dz-icon {
  font-family: var(--mono);
  font-size: 20px;
  line-height: 1;
  color: var(--gold-dim);
}
.dz-main { font-size: 13.5px; color: var(--text); }
.dz-sub { font-size: 11px; color: var(--dim); }

.import-preview {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.ip-avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--gold-dim);
  border-radius: 50%;
  color: var(--gold);
  font-family: var(--serif);
  font-size: 17px;
}
.ip-main { flex: 1 1 auto; min-width: 0; }
.ip-name { font-size: 14px; font-weight: 500; }
.ip-meta {
  display: block;
  margin-top: 2px;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.06em;
}
.ip-excerpt {
  margin: 5px 0 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}
.ip-change {
  align-self: center;
  padding: 4px;
  border: 0;
  background: none;
  color: var(--gold-dim);
  font-size: 11px;
  cursor: pointer;
}
.ip-change:hover { color: var(--gold); }

.dialog-actions button:disabled { opacity: 0.4; cursor: default; }
```

### Поведение

- Открытие: снять `.hidden` с оверлея, `body.no-scroll`, фокус на `#card-file` (кольцо видно на `.dropzone` через `:focus-within`); запомнить кнопку-инициатор.
- Закрытие: «Отмена», Esc, клик по фону. Вернуть фокус на инициатора, снять `.no-scroll`, очистить файл, превью и ошибку.
- Дроп: `dragover/dragenter` — `preventDefault` + `.is-over`; `dragleave/drop` — снять. Двойной `dragenter` не должен мигать: счётчик.
- Валидация файла: `.json` / `.png`, размер ≤5 МБ. JSON парсить на сервере, PNG — читать `tEXt`/`iTXt` чанк `chara` (base64 JSON). Один вход: `POST /api/cards/import` (multipart) → `{ name, description, personality, scenario, firstMes, tags, skills }`; существующий `POST /api/campaign/:id/card` принимает уже разобранный `{ card }`.
- Валидность: `spec === "chara_card_v2"` и непустой `data.name`. V1 не принимать.
- Пока идёт разбор: `.dropzone` полупрозрачный, текст «читаю карточку…», «Использовать» disabled.
- Ошибки (текстом, без стека): «это не карточка V2 — нет data.name», «файл больше 5 МБ», «PNG без карточки внутри», «не удалось прочитать JSON».
- Успех: превью, «Использовать» активна. В режиме «герой» клик закрывает диалог, выбирает плитку «Свой герой», заполняет поля мастера, переводит на шаг 3 и показывает тост «карточка загружена: <имя>». В режиме «знакомый» — отправляет `{ card }` в `POST /api/campaign/:id/card`, обновляет панель и открывает карточку нового NPC. Кампания автоматически не создаётся.
- «Заменить» в превью снова открывает выбор файла, не закрывая диалог; ошибка прошлого файла при этом очищается.
- Маппинг V2:

| Поле V2 | Куда |
|---|---|
| `data.name` | `hero.name` |
| `data.description` | `hero.essence` |
| `data.personality` | `hero.quirks` |
| `data.first_mes` | `hero.start` |
| `data.tags` | чипсы карточки/меты |
| `data.extensions.omika.skills` | `skills` |

- Клавиатура: Tab по зоне → кнопкам, Esc закрывает; фокус не уходит за пределы диалога.

### Мобильный

```css
@media (max-width: 900px) {
  .overlay { align-items: end; padding: 0; }
  .import-dialog {
    position: fixed;
    inset: auto 0 0;
    width: 100%;
    max-width: 100%;
    max-height: 90dvh;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
    border-radius: 14px 14px 0 0;
    overflow-y: auto;
  }
  .dropzone { min-height: 120px; }
  .dialog-actions { flex-direction: column-reverse; }
  .dialog-actions button { width: 100%; justify-content: center; }
}
```

- На тач-устройствах drag&drop не обещаем: `.dz-main` меняется на «Нажми, чтобы выбрать файл», `.dz-sub` остаётся с форматами.
- Шторка не выше 90dvh, кнопки — на всю ширину, primary сверху (последним в DOM при `column-reverse`).
- Нативный файловый пикер открывается по тапу на всю зону, а не только на текст.

---

## Стыковка с текущим кодом

| Блок | Уже есть | Что меняем по спеке |
|---|---|---|
| Карта | `#side-map`, `renderDungeon`, 31×14, 7.6px | `.map-box/.dmap`, 10px, разбивка по клеткам, мобильный `.map-mobile` |
| Мысли | `.thoughts`, `hero.intuition` | тот же класс и поле; внутри `.thought`, иконка, закрытие, опциональный `intuitionKind` |
| d36 | `.dice-toggle` с эмодзи, результат строкой `.msg.system` | `.dice-face` вместо эмодзи, карточка `.msg.roll`, `Roll { face, joker, label }` |
| Фракции | `leader/shadow/roster` внутри `.card` | `.fcard`, счётчик скрытых, компактные роли |
| Скиллы | `.skills-line` текстом | тот же класс, разметка по скиллам, 8 имён и порядок `SKILL_NAMES` |
| Новая игра | `.template-grid` auto-fill, `.template-tile` | ровно 3 колонки, «Свой герой» на всю ширину, `.start-bar` |
| Чипсы | `.quick-actions`, `.chip.quick`, 4 действия | те же классы, одна строка, вставка без отправки |
| Импорт | `⤒` в шапке игры, нативный файл | общий диалог, режимы «герой» и «знакомый», превью |

Старые правила `.side-map`, `.thoughts`, `.dice-toggle` (inline-flex + `accent-color`), `.skills-line`, `.template-tile b/span`, `.template-grid` (auto-fill) и `.quick-actions` (`flex-wrap: wrap`) удалить или переопределить: в спеке другие метрики и разметка.

---

## Чеклист: что внедрять первым

1. **Токены и сайдбар 240px** — 0,5 часа. Без этого карта не влезает: 216px даёт 170px под 31 символ.
2. **Чипсы быстрых действий** — 1 час, только клиент. Даёт немедленный эффект и не требует схемы.
3. **d36: тумблер + карточка броска** — 2–3 часа. Нужен `roll` в `done`/SSE и `turn.roll` для истории.
4. **Карта** — 1–1,5 дня. Сначала контракт `rows: 31×14`, потом рендер в `#side-map` и `.map-mobile`.
5. **Строка скиллов** — 1 час: данные уже есть, заменить текст `formatSkills` на разметку `.skill`.
6. **Мысли** — 2 часа: `hero.intuition` уже есть, собрать `.thought` с иконкой и закрытием.
7. **Фракции** — 3–4 часа: схема `leader/shadow/roster` уже есть, довести `.fcard` и скрытие имён.
8. **Новая игра и импорт V2** — 2–3 дня. Шаблоны удалены; остаются форма героя, `.start-bar` и общий диалог импорта.

Порядок первых трёх не важен, но до карты нужны новые токены: чипсы и d36 задают ритм нижней части экрана, карта на них опирается.
