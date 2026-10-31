/**
 * Встраивание метаданных в PNG (tEXt).
 *
 * Формат карточек SillyTavern хранит JSON в текстовом чанке `chara`
 * (base64). Мы делаем то же самое: файл остаётся обычной картинкой,
 * но внутри него лежит карточка персонажа.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC32 по стандарту PNG. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Разобрать PNG на чанки: [{type, data, raw}]. */
function readChunks(buffer: Buffer): { type: string; data: Buffer; raw: Buffer }[] {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('это не PNG');
  const chunks: { type: string; data: Buffer; raw: Buffer }[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error('битый PNG: обрезанный чанк');
    const raw = buffer.subarray(offset, end);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data: Buffer.from(data), raw: Buffer.from(raw) });
    offset = end;
  }
  return chunks;
}

/** Проверить, что буфер — целый PNG. */
export function isPng(buffer: Buffer): boolean {
  try {
    const chunks = readChunks(buffer);
    return chunks.length > 0 && chunks[chunks.length - 1].type === 'IEND';
  } catch {
    return false;
  }
}

/** Достать значение tEXt по ключу. */
export function readPngText(buffer: Buffer, keyword: string): string | null {
  for (const chunkInfo of readChunks(buffer)) {
    if (chunkInfo.type !== 'tEXt') continue;
    const nul = chunkInfo.data.indexOf(0);
    if (nul < 0) continue;
    const key = chunkInfo.data.subarray(0, nul).toString('latin1');
    if (key === keyword) return chunkInfo.data.subarray(nul + 1).toString('latin1');
  }
  return null;
}

/** Вставить tEXt перед IEND; существующий ключ заменяется. */
export function embedPngText(buffer: Buffer, keyword: string, value: string): Buffer {
  const chunks = readChunks(buffer);
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
  const textChunk = chunk('tEXt', data);

  const parts: Buffer[] = [SIGNATURE];
  for (const item of chunks) {
    if (item.type === 'tEXt') {
      const nul = item.data.indexOf(0);
      if (nul >= 0 && item.data.subarray(0, nul).toString('latin1') === keyword) continue;
    }
    if (item.type === 'IEND') parts.push(textChunk);
    parts.push(item.raw);
  }
  return Buffer.concat(parts);
}
