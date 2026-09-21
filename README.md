# Merge Pong Idle

A portrait mobile idle game prototype built with **Vite + TypeScript + Phaser 3 (Matter.js physics)**.

Permanent balls bounce around an arena. The whole top wall is one big paddle, and you drag the paddles on the bottom, left and right to catch balls and earn money. Buy more balls, merge two balls of the same level into a stronger one, add paddles, and unlock new arenas. There's no opponent, no lives and no game over: a missed ball just bounces off the wall.

Every graphic is drawn procedurally and every sound is synthesised with the Web Audio API, so there are no external assets.

**Play online:** https://irvanfaturohman.github.io/pong-idle/

## Install & run

```bash
npm install
npm run dev        # http://localhost:5173, also reachable from your LAN
```

Production build:

```bash
npm run build      # type-checks with tsc, then builds to dist/
npm run preview    # serves dist/ at http://localhost:4173, also on your LAN
```

Requires Node 20.19+ (or 22.12+).

### Deploy to GitHub Pages

```bash
npm run deploy     # builds, then pushes dist/ to the gh-pages branch
```

The repository's Pages source is the `gh-pages` branch. The build uses relative paths, so it works under `/pong-idle/`. Old `/classic/` links redirect to the game.

## How to play

| Action | Touch | Mouse |
| --- | --- | --- |
| Move a paddle | Drag it along its rail | Click and drag |
| Speed up | Tap the open arena (taps stack up to ×2.5) | Click the arena |
| Buy / merge / add paddle | Tap the cards at the bottom | Click |
| Mute | Speaker button (top right) | |
| Settings / reset | Gear button (top right) | |

- **Paddle hits earn money**: `ball value × combo × map multiplier`.
- **Combo**: each consecutive paddle hit adds +0.1 (up to ×2.0). Touching a bare wall resets it. Obstacles don't reset it.
- **Ball values**: LV1 $1, LV2 $4, LV3 $12, LV4 $36, LV5 $108, then ×3 per level.
- **Add Ball**: cheap on purpose ($12 × 1.1ⁿ), up to **40 balls**. A full, busy arena is the fun part. When it's full the card shows `FULL — MERGE BALLS`.
- **Merge Balls**: free. Each press merges one pair at the lowest level (e.g. `2× LV.1 → LV.2`), picking the two closest balls. Tapping again while a merge is playing queues the next one (up to 5).
- **Paddles**: the top wall is a fixed full-width paddle, so every top bounce pays. You start with one paddle each on the bottom, left and right.
- **Add Paddle**: $100 × 2.15ⁿ, added in the order bottom, left, right (twice), up to 9 paddles (3 per side).
- **Tap to speed up**: tapping empty arena space speeds up the whole simulation for a moment. Speed lines and an edge glow show the boost, and a `SPEED ×N` pill shows the current multiplier.
- **Maps** move forward on money *earned* on the current map. Spending never costs progress.
  1. **Classic Chamber**: ×1.0, clear at $10,000 earned
  2. **Diamond Core**: ×1.5, a diamond bumper in the centre, 5% faster, clear at $200,000
  3. **Twin Bumpers**: ×2.25, two round bumpers and a rotating bar, 8% faster, clear at $1,000,000

  In simulation, an active player reaches the Prototype Complete screen in about 15–20 minutes.
  4. After Map 3 you get a **Prototype Complete** screen with your stats. **Continue Endless** keeps you on Map 3, and each tier's target and multiplier go up.

Balls, levels, money and paddles carry over between maps.

## Testing on a phone

1. Run `npm run dev` (or `npm run build && npm run preview`).
2. Vite prints a **Network** URL such as `http://192.168.1.23:5173`. Open it on a phone on the same Wi-Fi.
3. Hold the phone in portrait. In landscape the game pauses and asks you to rotate.

If the phone can't connect, allow Node through your computer's firewall.

## Balancing & configuration

All tunable values live in data/config files:

| File | Contents |
| --- | --- |
| `src/game/data/economy.ts` | Ball values, combo step/max, Add Ball & Add Paddle cost curves, income window, endless growth |
| `src/game/data/maps.ts` | Map names, multipliers, targets, speed factors, palettes, obstacle layouts, spawn/merge point |
| `src/game/data/levels.ts` | Ball colours per level, radius curve, star markers for high levels |
| `src/game/config.ts` | Layout, ball speed, physics stability limits, paddle size/sides/purchase order/max count, max balls, tap boost, audio volume, juice intensities, timings |

## Project structure

```
index.html                Game page
classic/index.html        Redirect for old /classic/ links
src/
  main.ts                 Phaser config, gesture blocking, orientation handling
  styles.css              Full-screen portrait layout, safe areas, rotate overlay
  game/
    config.ts             Tunables (see above)
    context.ts            Shared services (state, save, economy, audio, haptics)
    types.ts
    data/                 economy.ts, maps.ts, levels.ts
    scenes/               BootScene (textures), GameScene (arena), UIScene (HUD & menus)
    entities/             Ball.ts, Paddle.ts
    systems/              EconomySystem, MapManager, SaveSystem, AudioManager, JuiceManager,
                          MergeSystem, TutorialManager, Haptics, EventBus
    ui/                   Hud, UpgradeButton, Panels (settings / complete), SpeedLines, widgets
    utils/                formatNumber, math, textures (procedural canvas textures)
```

## Saving & resetting

Progress auto-saves to `localStorage` under the key `merge-pong-idle:save`. It saves after every purchase, merge, map change and settings change, every 10 seconds, and whenever the tab is hidden or closed. The save is versioned: older saves are migrated, and corrupt data falls back to a fresh game.

To reset:
- In game: **Settings (gear) → Reset Progress → Reset**, or
- In the browser console: `localStorage.removeItem('merge-pong-idle:save')`, then close the tab and open it again. The game saves when the page unloads, so a plain refresh right after removing the key would write the save back.

## Notes

- The game renders at a fixed 1080×1920 virtual resolution and scales to fit. On phones taller than 9:16 (e.g. 360×800) there are thin bars above and below in the same colour as the background.
- Haptics use `navigator.vibrate`, which iOS Safari doesn't support. The setting is still there, and the settings panel says when it's unsupported.
- Balls don't collide with each other. This is on purpose, to keep many balls readable and to keep merges from getting stuck.
