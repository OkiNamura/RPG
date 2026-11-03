/** Мягкий anti-slop: не цензура, а удаление буквальных повторов. */
const SLOP = [
  /^вдалеке (где-то )?(лает|завыла|скрипит|грохочет)/i,
  /^ты чувствуешь, как/i,
  /^холодок (пробегает|прокрадывается)/i,
];

export function cleanProse(value: string): string {
  const paragraphs = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const keptParagraphs: string[] = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph
      .split(/(?<=[.!?…])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const kept: string[] = [];
    for (const sentence of sentences) {
      if (kept.length && kept[kept.length - 1].toLowerCase() === sentence.toLowerCase()) continue;
      if (kept.length >= 2 && kept.slice(-2).every((item) => item.toLowerCase() === sentence.toLowerCase())) continue;
      if (SLOP.some((pattern) => pattern.test(sentence)) && kept.some((item) => item.length > 40)) continue;
      kept.push(sentence);
    }
    const cleaned = kept.join(' ').trim();
    if (!cleaned) continue;
    if (keptParagraphs.length && keptParagraphs[keptParagraphs.length - 1].toLowerCase() === cleaned.toLowerCase()) continue;
    keptParagraphs.push(cleaned);
  }
  return keptParagraphs.join('\n\n');
}
