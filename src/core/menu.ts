/** One finished plate the kitchen pushes through the window. */
export interface Product {
  /** ASCII, stable across builds: stored events refer to it. */
  readonly id: string;
  readonly label: string;
  readonly menuName: string;
  readonly preisschildPosition: number;
}

// Edited before a Fest and never during one. The array order is the display order: the fast dishes
// first (decided in "Window screen prototype").
export const MENU: readonly Product[] = [
  {
    id: "flammkuchen",
    label: "Flammkuchen",
    menuName: "Flammkuchen Elsässer Art (Speck und Zwiebeln)",
    preisschildPosition: 4,
  },
  {
    id: "flammkuchen-veggie",
    label: "Flammkuchen Veggie",
    menuName: "Flammkuchen vegetarisch (Paprika, Mais und Zwiebeln)",
    preisschildPosition: 5,
  },
  {
    id: "pfannkuchen",
    label: "Pfannkuchen",
    menuName: "Pfannkuchen mit Apfelmus",
    preisschildPosition: 8,
  },
  {
    id: "pommes",
    label: "Pommes",
    menuName: "Pommes Frites",
    preisschildPosition: 10,
  },
  {
    id: "braten",
    label: "Braten",
    menuName: "Schweinebraten mit Kraut und Schupfnudeln",
    preisschildPosition: 1,
  },
  {
    id: "schaeufele",
    label: "Schäufele",
    menuName: "Kasslerschäufele mit Kraut und Schupfnudeln",
    preisschildPosition: 2,
  },
  {
    id: "schlachtplatte",
    label: "Schlachtplatte",
    menuName: "Schlachtplatte mit Kraut und Brot",
    preisschildPosition: 3,
  },
  {
    id: "maultaschen",
    label: "Maultaschen",
    menuName: "2 Maultaschen in der Fleischbrühe",
    preisschildPosition: 6,
  },
  {
    id: "schupfnudeln",
    label: "Schupfnudeln",
    menuName: "Schupfnudeln mit Kraut",
    preisschildPosition: 7,
  },
  {
    id: "fleischkaes",
    label: "Fleischkäs",
    menuName: "Fleischkäsbrötchen",
    preisschildPosition: 9,
  },
];
