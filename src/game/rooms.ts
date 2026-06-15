import type { RoomCard } from "../shared/types";

export const ROOMS: RoomCard[] = [
  {
    id: "gatehouse",
    title: "Gatehouse of Grins",
    subtitle: "The party finds the first locked pun-door.",
    trapCount: 3,
    curse: "No gestures during the first ten seconds."
  },
  {
    id: "moss-steps",
    title: "Moss-Slick Steps",
    subtitle: "Every clue echoes a little too loudly.",
    trapCount: 4,
    curse: "The clue-giver may not use numbers."
  },
  {
    id: "ink-well",
    title: "Ink Well Crossing",
    subtitle: "Books whisper suspicious definitions.",
    trapCount: 5,
    curse: "The clue-giver may not say a word that starts with the target's first letter."
  },
  {
    id: "mimic-hall",
    title: "Mimic Hall",
    subtitle: "Some furniture is listening.",
    trapCount: 5,
    curse: "The trap team may include one two-word trap phrase."
  },
  {
    id: "moon-vault",
    title: "Moon Vault",
    subtitle: "A silver lock demands precision.",
    trapCount: 6,
    curse: "The clue-giver may not use proper nouns."
  },
  {
    id: "candle-crypt",
    title: "Candle Crypt",
    subtitle: "The floor clicks under every obvious clue.",
    trapCount: 7,
    curse: "The clue-giver may not say opposites such as hot/cold or up/down."
  },
  {
    id: "boss-door",
    title: "The Lockjaw Wyrm",
    subtitle: "The final monster eats lazy clues.",
    trapCount: 8,
    curse: "Boss rule: one trap may be declared after the clue if the table agrees it was clearly implied."
  }
];
