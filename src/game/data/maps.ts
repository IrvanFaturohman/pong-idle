import type { MapDef } from '../types';

/**
 * Map definitions. Geometry is expressed relative to the arena center so the
 * arena can move in the layout without touching map data.
 */
export const MAPS: readonly MapDef[] = [
  {
    id: 1,
    name: 'Classic Chamber',
    multiplier: 1,
    target: 10000,
    speedFactor: 1,
    palette: {
      background: 0x0f131c,
      arenaTop: 0x1a212e,
      arenaBottom: 0x151a24,
      border: 0x2b3444,
      rail: 0x46526a,
      paddle: 0xffc83d,
      accent: 0xffc83d,
      obstacle: 0xffc83d,
      obstacleLight: 0xffe08a,
      obstacleDark: 0xd99a1a,
      secondary: 0xff8f70,
    },
    obstacles: [],
    focus: { x: 0, y: 0 },
  },
  {
    id: 2,
    name: 'Diamond Core',
    multiplier: 1.5,
    target: 200000,
    speedFactor: 1.05,
    palette: {
      background: 0x11121f,
      arenaTop: 0x1d1e35,
      arenaBottom: 0x16172a,
      border: 0x34365a,
      rail: 0x555a8c,
      paddle: 0xffc83d,
      accent: 0x9d8cff,
      obstacle: 0x8f7dff,
      obstacleLight: 0xbdb2ff,
      obstacleDark: 0x6150d8,
      secondary: 0xff8f70,
    },
    obstacles: [{ kind: 'diamond', x: 0, y: 40, halfWidth: 125, halfHeight: 165 }],
    focus: { x: 0, y: -360 },
  },
  {
    id: 3,
    name: 'Twin Bumpers',
    multiplier: 2.25,
    target: 1000000,
    speedFactor: 1.08,
    palette: {
      background: 0x0c1519,
      arenaTop: 0x14252b,
      arenaBottom: 0x0f1d22,
      border: 0x24414a,
      rail: 0x39636e,
      paddle: 0xffc83d,
      accent: 0x3fd6c2,
      obstacle: 0x3fd6c2,
      obstacleLight: 0x94f2e5,
      obstacleDark: 0x1f9e8c,
      secondary: 0xff8f70,
    },
    obstacles: [
      { kind: 'bumper', x: -255, y: -210, radius: 74 },
      { kind: 'bumper', x: 255, y: -210, radius: 74 },
      { kind: 'bar', x: 0, y: 170, length: 290, thickness: 30, angularSpeed: 0.75 },
    ],
    focus: { x: 0, y: -40 },
  },
];

export const FINAL_MAP_INDEX = MAPS.length - 1;

export function getMap(index: number): MapDef {
  return MAPS[Math.max(0, Math.min(MAPS.length - 1, index))];
}
