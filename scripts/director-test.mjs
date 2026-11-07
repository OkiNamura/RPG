#!/usr/bin/env node
import { directorQuestion, shouldRunDirector } from '../src/core/director.ts';

const base = { turn: 1, hasScene: true, stalls: 0, sceneId: 'scene-1', lastSceneId: 'scene-1', lastTurn: 1 };
if (!shouldRunDirector({ ...base, lastTurn: undefined })) throw new Error('первый ход без Director');
if (shouldRunDirector({ ...base, turn: 2 })) throw new Error('Director на каждом ходу');
if (shouldRunDirector({ ...base, turn: 3 })) throw new Error('Director на каждом ходу');
if (!shouldRunDirector({ ...base, turn: 4 })) throw new Error('нет страховки через 3 хода');
if (!shouldRunDirector({ ...base, turn: 2, stalls: 2 })) throw new Error('stalls не вызывает Director');
if (!shouldRunDirector({ ...base, turn: 2, sceneId: 'scene-2' })) throw new Error('новая сцена не вызывает Director');
if (!shouldRunDirector({ ...base, turn: 1, lastTurn: 1 })) throw new Error('regenerate не вызывает Director');
if (directorQuestion('# Сцена\nЧто здесь не так?') !== 'Что здесь не так?') throw new Error('вопрос Director не извлечён');
if (directorQuestion('Без вопроса.') !== undefined) throw new Error('выдуман вопрос сцены');
console.log('✓ Director: событие, stalls, новая сцена и regenerate');
console.log('✓ question сцены только из Director');
