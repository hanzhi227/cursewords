import type { DeckMode, WordSource } from "../shared/types";

const COMMON_WORDS = [
  "Anchor",
  "Apron",
  "Balcony",
  "Bicycle",
  "Blanket",
  "Blueprint",
  "Bonfire",
  "Cactus",
  "Camera",
  "Carnival",
  "Compass",
  "Concert",
  "Diamond",
  "Elevator",
  "Feather",
  "Fireplace",
  "Garden",
  "Glacier",
  "Harbor",
  "Helmet",
  "Island",
  "Jacket",
  "Kettle",
  "Lantern",
  "Library",
  "Lightning",
  "Market",
  "Mirror",
  "Mountain",
  "Notebook",
  "Orchestra",
  "Painter",
  "Parachute",
  "Penguin",
  "Picnic",
  "Pillow",
  "Planet",
  "Pocket",
  "Postcard",
  "Raincoat",
  "River",
  "Rocket",
  "Saddle",
  "Sandbox",
  "Shadow",
  "Skyscraper",
  "Snowman",
  "Submarine",
  "Suitcase",
  "Telescope",
  "Thunder",
  "Toaster",
  "Treasure",
  "Umbrella",
  "Violin",
  "Volcano",
  "Waterfall",
  "Wheelbarrow",
  "Whistle",
  "Windmill"
];

const ARCANE_WORDS = [
  "Alchemist",
  "Amulet",
  "Basilisk",
  "Battlement",
  "Beholder",
  "Cauldron",
  "Chimera",
  "Cloak",
  "Crystal",
  "Dragon",
  "Dungeon",
  "Enchanter",
  "Familiar",
  "Gargoyle",
  "Goblin",
  "Griffin",
  "Hex",
  "Hydra",
  "Labyrinth",
  "Leviathan",
  "Manticore",
  "Minotaur",
  "Necromancer",
  "Oracle",
  "Paladin",
  "Phoenix",
  "Portal",
  "Potion",
  "Relic",
  "Rune",
  "Scepter",
  "Scroll",
  "Sentinel",
  "Sorcerer",
  "Spellbook",
  "Sphinx",
  "Talisman",
  "Tavern",
  "Throne",
  "Torch",
  "Troll",
  "Valkyrie",
  "Wand",
  "Warlock",
  "Witch",
  "Wyvern"
];

export function deckForMode(mode: DeckMode, wordSource: WordSource = "built-in", customWords: string[] = []) {
  const builtIn = builtInDeck(mode);
  if (wordSource === "custom") return [...customWords];
  if (wordSource === "combined") return uniqueWords([...builtIn, ...customWords]);
  return builtIn;
}

function builtInDeck(mode: DeckMode) {
  if (mode === "common") return [...COMMON_WORDS];
  if (mode === "arcane") return [...ARCANE_WORDS];
  return [...COMMON_WORDS, ...ARCANE_WORDS];
}

function uniqueWords(words: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const word of words) {
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(word);
  }
  return unique;
}
