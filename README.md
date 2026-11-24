# JerryQuest

A cosy medieval role-playing game you play in the browser with friends. Storybook look inspired by bright cartoon RPGs, with RuneScape-style skills that level up as you use them.

## What's in it so far (step 2: single-player slice)

- Three classes: Knight (Melee), Mage (Magic) and Archer (Ranged). Switch class any time; skills, bag, coins and quests belong to your character.
- Seven skills: Melee, Magic, Ranged, Speed, Woodcutting, Mining and Fishing.
- Gathering: trees and oaks to chop, copper and iron rocks to mine, shrimp and trout spots at the lake.
- Combat with a skeleton camp, health bars, loot and respawns.
- Three starter quests from villagers in Greenhollow.
- Progress saves in the browser (online accounts come in step 3).

## Running it

It's a static site. Serve the `game/` folder with any static server, for example:

```
cd game && python3 -m http.server 8000
```

then open http://localhost:8000.

## How it's built

- [Three.js](https://threejs.org/) 0.170 loaded from jsDelivr.
- `engine.js`: renderer, cartoon (toon) materials, ink-outline post-processing, particles, model loading.
- `world.js`: the village, lake, forest and scenery.
- `game.js`: classes, skills, gathering, combat, quests, UI and saving.
- `icons.js`: hand-drawn item and skill icons, painted on canvases.

### Art

All 3D models are by Kay Lousberg ([KayKit](https://kaylousberg.com)), released under CC0 (free for any use, no credit required, credited here anyway):
KayKit Adventurers, KayKit Skeletons, KayKit Medieval Hexagon Pack.

Monsters also use Quaternius models ([quaternius.com](https://quaternius.com), CC0). The big dragons (Gagron, Magma Drake, Elder Flame Dragon, Pyrrhax) use the dragon model and animations from [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) (CC0), repainted per dragon in `game/tex/drake_*.png`.
The /dog prank uses the Shiba Inu from Quaternius' Ultimate Animated Animals (CC0), with smoothed shading (`tools/packdog.mjs`).

Models are stored as base64-encoded, quantized GLB files in `game/models/*.txt` with textures in `game/tex/`. `tools/` has the scripts that build them from the KayKit packs (`strip.mjs` trims animations, `merge.mjs` combines world props, `pack.mjs` quantizes and encodes). They need `npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions`.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

The landscape (trees, bushes, grass, flowers, ferns, toadstools, rocks and pebbles) uses the free version of Quaternius' [Stylized Nature MegaKit](https://quaternius.com) (CC0). `tools/nature.mjs` builds `game/models/nature.txt` from it and writes the shrunk textures to `game/tex/nat_*.png` (the leaf textures are then re-painted as soft grey leaf shapes that the game colours in).
