/**
 * Конспект кампании — append-only.
 *
 * Ключевое правило: закрытая арка НИКОГДА не перегенерируется.
 * Пересказ пересказа деградирует — детали обрастают подробностями,
 * которых не было, а однократные факты исчезают. Плюс append-only
 * держит префикс контекста стабильным, а значит — кэш живым.
 */

export interface Arc {
  title: string;
  body: string;
  closed: boolean;
}

export class Conspect {
  readonly header: string;
  private arcs: Arc[] = [];

  constructor(header = '') {
    this.header = header;
  }

  /** Полный рестарт: забыть все арки, шапку оставить. */
  clear(): void {
    this.arcs = [];
  }

  get arcCount(): number {
    return this.arcs.length;
  }

  get closedCount(): number {
    return this.arcs.filter((a) => a.closed).length;
  }

  /** Начать новую арку: предыдущая закрывается и замораживается. */
  openArc(title: string): void {
    const last = this.arcs[this.arcs.length - 1];
    if (last && !last.closed) last.closed = true;
    this.arcs.push({ title, body: '', closed: false });
  }

  /** Дописать строку в текущую арку. Только добавление, не правка. */
  addLine(line: string): void {
    if (this.arcs.length === 0) this.openArc('Арка 1');
    const last = this.arcs[this.arcs.length - 1];
    last.body += (last.body ? '\n' : '') + line;
  }

  /** Слой `slow`: всё, что уже не меняется. */
  renderFrozen(): string {
    const closed = this.arcs.filter((a) => a.closed);
    if (closed.length === 0) return '';
    const blocks = closed.map((a) => `## ${a.title}\n${a.body}`);
    return [this.header, ...blocks].filter(Boolean).join('\n\n');
  }

  /** Слой `fast`-рядом: текущая арка, она ещё растёт. */
  renderRecent(): string {
    const open = this.arcs.find((a) => !a.closed);
    if (!open) return '';
    return `## ${open.title} (текущая)\n${open.body}`;
  }

  toJSON(): Arc[] {
    return structuredClone(this.arcs);
  }

  static fromJSON(arcs: Arc[], header = ''): Conspect {
    const c = new Conspect(header);
    c.arcs = structuredClone(arcs);
    return c;
  }
}
