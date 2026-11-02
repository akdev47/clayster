// The steps the pipeline reports while it works, as the page shows them. The
// English names are what the code uses to tell the steps apart; only the page
// text is Dutch.
const STAGES = {
  "element conversion": "ontwerp omzetten",
  "SVG loading": "SVG laden",
  "SVG parsing": "SVG lezen",
  "SVG shape conversion": "SVG-vormen omzetten",
  "SVG normalization": "SVG normaliseren",
  "geometry validation": "geometrie controleren",
  "stamp preparation": "stempel voorbereiden",
  "stamp generation": "stempel opbouwen",
  "final mesh validation": "eindcontrole van het oppervlak",
  artwork: "ontwerp",
  complete: "klaar",
};

export function stageLabel(stage) {
  return STAGES[stage] ?? stage;
}
