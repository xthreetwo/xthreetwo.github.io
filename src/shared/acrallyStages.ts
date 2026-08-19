export interface AcrallyStageGroup {
  category: string;
  stages: readonly string[];
}

export const ACRALLY_STAGE_GROUPS: readonly AcrallyStageGroup[] = [
  {
    category: "Rally Greece",
    stages: [
      "Elatia - Zeli",
      "Zeli - Elatia",
      "Elatia",
      "Elatia (Reverse)",
      "Zeli",
      "Zeli (Reverse)",
      "Loutraki - Aghii Theodori",
      "Aghii Theodori - Loutraki",
      "New Loutraki",
      "New Loutraki (Reverse)",
      "Aghii Theodori",
      "Aghii Theodori (Reverse)",
    ],
  },
  {
    category: "Monte Carlo",
    stages: [
      "Sisteron - St. Geniez",
      "St. Geniez - Sisteron",
      "Sisteron - Mézien",
      "Mézien - Sisteron",
      "Mézien - St. Geniez",
      "St. Geniez - Mézien",
      "La Bollène-Véubie - Peïra Cava",
      "Peïra Cava - La Bollène-Véubie",
      "La Bollène-Véubie - Turini",
      "Turini - La Bollène-Véubie",
      "Turini - Peïra Cava",
      "Peïra Cava - Turini",
      "Par d'Alart",
      "Sommet de Turini",
    ],
  },
  {
    category: "Livigno Circuit",
    stages: ["Main Circuit", "Main Circuit Reverse"],
  },
  {
    category: "Wales",
    stages: [
      "Cwmbiga - Afon Biga",
      "Afon Biga - Cwmbiga",
      "Cwmbiga - Fedw Fain",
      "Fedw Fain - Cwmbiga",
      "Banc Gwyn - Afon Biga",
      "Afon Biga - Banc Gwyn",
      "Afon Bidno - Severn",
      "Severn - Afon Bidno",
    ],
  },
  {
    category: "France",
    stages: [
      "Vallée de Munster Descente",
      "Vallée de Munster Montée",
      "Forêt de Munster",
      "Luttenbach près Munster",
      "Col du petit Ballon",
      "Sommet de Munster",
      "Steigenbach",
      "Forêt de Saverne",
      "Obersteigen",
      "La traversée de La Mossig",
    ],
  },
];

export function getAllAcrallyStages(): string[] {
  return ACRALLY_STAGE_GROUPS.flatMap((group) => [...group.stages]);
}

export function getDefaultAcrallyStage(): string {
  return ACRALLY_STAGE_GROUPS[0]?.stages[0] ?? "";
}

export function renderAcrallyStageOptions(
  selected?: string,
  escape: (text: string) => string = (text) => text
): string {
  return ACRALLY_STAGE_GROUPS.map((group) => {
    const options = group.stages
      .map((stage) => {
        const isSelected = stage === selected;
        return `<option value="${escape(stage)}" ${isSelected ? "selected" : ""}>${escape(stage)}</option>`;
      })
      .join("");

    return `<optgroup label="${escape(group.category)}">${options}</optgroup>`;
  }).join("");
}

export const ACRALLY_STAGES = getAllAcrallyStages();

export type AcrallyStage = string;
