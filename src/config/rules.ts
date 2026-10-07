/** Zasady meczu. Wszystkie wartości można zmieniać bez dotykania logiki. */
export interface Rules {
  startPD: number;
  /** Dochód bazowy PD na sekundę. */
  baseIncomePD: number;
  /** Dodatkowe PD na sekundę za każdą kontrolowaną (niesporną) strefę. */
  zoneIncomePD: number;
  /** PZ na sekundę za każdą kontrolowaną (niesporną) strefę. */
  zonePZ: number;
  winPZ: number;
  /** Limit czasu meczu [s]. */
  timeLimit: number;
  /** Limit aktywnych jednostek (wraz z kolejką i pasażerami). */
  unitCap: number;
  /** Czas przyjazdu posiłków [s]. */
  reinforceDelay: number;
  zoneCount: number;

  /** Czas jednego etapu przejmowania przez 1 jednostkę piechoty [s]. */
  captureTime: number;
  /** Maksymalny mnożnik szybkości przejmowania (dodatkowa piechota). */
  captureMaxMult: number;
  /** Wzrost mnożnika za każdą kolejną jednostkę piechoty. */
  captureMultPerUnit: number;
  /** Prędkość cofania się postępu (ułamek prędkości przejmowania). */
  captureDecay: number;
  zoneRadius: number;

  /** Promień, w którym można załadować jednostki do transportera. */
  loadRadius: number;
  boardDistance: number;
  /** Maksymalna odległość pościgu od punktu postoju dla jednostek bez rozkazu. */
  leash: number;

  /** Krok symulacji [s]. */
  simStep: number;
  /** Co ile sekund AI podejmuje decyzje strategiczne. */
  aiInterval: number;
}

export const DEFAULT_RULES: Rules = {
  startPD: 300,
  baseIncomePD: 3,
  zoneIncomePD: 1,
  zonePZ: 1,
  winPZ: 1000,
  timeLimit: 15 * 60,
  unitCap: 40,
  reinforceDelay: 5,
  zoneCount: 5,

  captureTime: 12,
  captureMaxMult: 2,
  captureMultPerUnit: 0.5,
  captureDecay: 0.25,
  zoneRadius: 90,

  loadRadius: 140,
  boardDistance: 52,
  leash: 280,

  simStep: 1 / 30,
  aiInterval: 1.5,
};
