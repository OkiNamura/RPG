/**
 * Интерфейс модели. Всё, что общается с провайдером, прячется за ним,
 * чтобы движок не знал, локальная это модель, OpenRouter или мок.
 */

import { estimateTokens } from './context.ts';
import type { Delta } from './delta.ts';

export interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelReply {
  text: string;
  /** если провайдер умеет структурный вывод — изменения приходят отдельным полем */
  delta?: Delta | null;
  outputTokens: number;
  /** реальные числа от провайдера, если он их вернул */
  inputTokens?: number;
  cachedTokens?: number;
}

export interface Model {
  readonly name: string;
  complete(messages: Msg[], maxTokens?: number): Promise<ModelReply>;
  /** потоковый ответ: отдаёт куски текста по мере генерации */
  stream?(messages: Msg[], onDelta: (text: string) => void): Promise<ModelReply>;
}

const PROSE = [
  'Ветер несёт пепел с востока, и он ложится на язык — горький, как ржавчина. У стены кто-то кашляет долго и надрывно, а потом замолкает. Под плащом холодеет пот.',
  'Дверь открывается без скрипа, и это хуже скрипа. Внутри пахнет мокрой шерстью и старой кровью. На полу — следы, которые кто-то пытался стереть, но бросил на середине.',
  'Ты слышишь, как за спиной шаги сбиваются с ритма: человек понял, что его услышали. Он не бежит. Он ждёт, что ты сделаешь.',
  'Огонь в жаровне дышит неровно, и тени на стенах дёргаются в такт. Кто-то оставил на столе миску с похлёбкой, ещё тёплой. Ложка лежит отдельно, будто её положили нарочно.',
  'Курган высится над трактом, как сломанный зуб. Ветер здесь тише, будто ему тоже не по себе. У подножия — свежие комья земли, и никто их не присыпал.',
  'Ночь выдавливает из щелей холод. Ты чувствуешь, как намокает воротник, и как где-то далеко, за стеной, кто-то начинает плакать — тихо, чтобы не услышали.',
];

const DELTAS: string[] = [
  '{"advanceHours":1,"weather":"пепельный ветер"}',
  '{"addItems":[{"name":"кусок ржавого железа","qty":1,"where":"inventory"}]}',
  '{"advanceHours":2}',
  '{"removeItems":[{"name":"кусок ржавого железа","qty":1}]}',
  '{"promises":["вернуться к закату"]}',
  '{"advanceHours":1,"place":"тракт у кургана"}',
];

/**
 * Мок-модель: гоняет весь цикл без сети и без денег.
 * Служит эталоном формата: проза отдельно, блок изменений — отдельно.
 */
export class MockModel implements Model {
  readonly name = 'mock';
  private n = 0;

  async complete(messages: Msg[]): Promise<ModelReply> {
    const i = this.n % PROSE.length;
    this.n += 1;

    void messages;
    const text = `${PROSE[i]}\n\n\`\`\`json\n${DELTAS[i]}\n\`\`\``;
    return { text, outputTokens: estimateTokens(text) };
  }
}
