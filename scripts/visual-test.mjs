#!/usr/bin/env node
import { buildSceneContract, referenceLegend, sceneSeed } from '../src/core/visuals.ts';

const references = [
  { name: 'Аня', url: 'a', role: 'hero' },
  { name: 'Ася', url: 'b', role: 'party' },
];
const contract = buildSceneContract({
  place: 'дом Аси, комната',
  time: 'день 2, 20:14',
  weather: 'туман',
  hero: { name: 'Аня' },
  actors: [
    { name: 'Аня', role: 'герой', present: true, status: 'alive' },
    { name: 'Ася', role: 'подруга', present: true, status: 'alive', appearance: 'тёмные волосы' },
    { name: 'Марк', role: 'одноклассник', present: false, status: 'alive' },
    { name: 'Лера', role: 'подруга', present: false, status: 'dead' },
  ],
  action: 'Ася у двери',
  references,
});

if (contract.cast.length !== 1 || contract.cast[0].name !== 'Ася') throw new Error('в кадре лишние персонажи');
if (!contract.forbidden.includes('Марк') || !contract.forbidden.includes('Лера')) throw new Error('нет запрета отсутствующих');
if (!referenceLegend(references).includes('Reference 1: Аня')) throw new Error('нет легенды референсов');
if (sceneSeed(['x']) !== sceneSeed(['x'])) throw new Error('seed нестабилен');
if (sceneSeed(['x']) === sceneSeed(['y'])) throw new Error('seed не различает сцены');
console.log('✓ контракт сцены: только присутствующие, отсутствующие запрещены');
console.log('✓ референсы и seed детерминированы');
