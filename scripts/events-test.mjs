#!/usr/bin/env node
import { createState, normalizeState } from '../src/core/state.ts';
import { applyDelta } from '../src/core/delta.ts';

const state = createState('Аня', 'дом');
state.time = { day: 2, hour: 20, minute: 0 };
applyDelta(state, {
  events: [{ title: 'встреча', at: { day: 2, hour: 22, minute: 30 }, importance: 'meaningful', wake: true }],
});
const event = state.events.find((item) => item.title === 'встреча');
if (!event || event.at.hour !== 22 || event.at.minute !== 30 || event.wake !== true) {
  throw new Error('событие не добавилось');
}
const old = { ...state, events: undefined };
normalizeState(old);
if (!Array.isArray(old.events)) throw new Error('старое сохранение без событий не нормализовалось');
console.log('✓ событие календаря добавлено');
console.log('✓ старые сохранения получают пустой календарь');
