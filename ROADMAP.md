# Roadmap

1. **Pick the look** (done): free KayKit models with storybook shading, ink outlines and warm lighting.
2. **Playable single-player slice** (done, being polished): one hero with a level and stats, gear-based builds, gathering skills, combat, inventory, quests and story chapter 1.
3. **Accounts and saving**: sign up and log in; character, skills, bag, quests and position saved online.
4. **Shared world**: everyone online in the same persistent world, gathering, fighting and questing together.

## Design rules

- **No classes (for now).** There is one hero. Your build comes from your gear and the stat points you spend.
- **Hero level** comes from XP: bosses and quests give the most, hitting and beating monsters gives some, gathering gives a little. Each level gives +1 Attack, +1 Defense and +1 Health automatically, plus 2 free points.
- **Stats:** Attack multiplies the weapon's base damage (×(1 + 0.1 × Attack)). Defense divides incoming damage (÷(1 + 0.1 × (Defense + shield + armour))). Health adds 6 max health per point (50 base). Defense and Health are tuned to be worth about the same, so neither is the obvious pick.
- **Items have stats:** weapons have damage, reach/range and swing time; the weapon type decides how you fight (melee swing, magic bolt or crossbow shot). Shields and armour add Defense.
- **Everything can be sold:** Marta buys anything in your bag, the smiths buy back spare gear. Monsters and bosses sometimes drop valuable treasures (silver rings, rubies, tiny golden crowns).
- Woodcutting, Mining and Fishing (and Speed) level by use and have no combat stats.
- Free aim: actions are never locked onto a target. A swing, chop or shot hits whatever hitbox it reaches in the direction you face. Trees, rocks and monsters all have health bars.
- One consistent art style. New models come from the KayKit family (or matching CC0 packs) and go through the same toon shading.

## Main story (optional, but the main path)

After a hundred years of peace the Heartstone's seal broke and dark magic is back. The Dark King, working name Morgoth the Menacing (one constant, `DARK_KING`, in game.js), is fought only at the very end. The story is a long arc of bosses and minibosses before that.

- Chapter 1, "The Seal Breaks" (built): King Jerrold, prove yourself, then win back three Heartstone shards from Bonecrusher, the Gloomcaster and Captain Rattlebones, in any order.
- Next: the fourth shard mystery in Honeymeadow, then more chapters, lands and bosses.
- Every story quest should be shareable by a party once online play exists.
- Side content stays separate so friends can play together any time.

## Ideas backlog (from Callum)

Playing with friends
- Parties that share XP and quest progress
- World bosses that need everyone (done so far: three minibosses, Bonecrusher, Gloomcaster and Captain Rattlebones, with telegraphed slam attacks)
- Friendly duels in a town arena
- Dokapon-style pranks, like a trap that turns a friend into a chicken for 30 seconds

Progression
- Classes may come back later, built from items and levels (for example a Paladin unlock at level 20)
- Gear that changes how your character looks
- Character customisation. Done: outfit and cape colours, helmet/hat and cape toggles, six hair styles in eight colours. Next: face and eye options. These need new face art painted onto the model texture, because the free character models have their faces baked in
- Rare drops with silly names
- Skill capes for maxing a skill

World
- Day and night cycle, with stronger monsters at night
- Hidden areas and secrets
- Pets that follow you and give buffs: more damage, defence, health, speed, or other passive bonuses
- A player house you can decorate

Skills
- Done: Marta's food stall (bread, pie, stew heal you; she buys logs, ore, fish and bones), minimap and full map (M), jumping (dodges melee swings)
- Cooking fish to heal
- Smithing ore into weapons
- Rare golden trees and ore spawns that friends race for
