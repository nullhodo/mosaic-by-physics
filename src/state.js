export const sketchTitle = "KineticGeometryCascade";

export const simulationState = {
  is3DMode: false,
  isDebugMode: false,
  spawnRateFrames: 5,
  shapeBaseRadius: 11,
  shapeSizeVariationPercent: 100,
  shapeVertexCount: 5,
  shapeCurvaturePercent: 100,
  floorOffsetDistance: -20,
  gravityForce: 1.0,
  restitutionCoeff: 0.3,
  pieceGapPercent: 12,
  isSineWaveSpawnActive: true,
  sineSpawnFlowRate: 2,
  activePaletteIndex: 1,
  pageBackgroundColorHex: "#dedede",
  canvasBackgroundColorHex: "#f8f9fa",
  backgroundColorHex: "#dedede",
  showPieceBorders: true,
  recordingDelaySeconds: 1.0,
  recordingResetAndDelay: true,
  recordingFramingMode: "centered",
  isGrainActive: true,
  grainIntensityPercent: 18,
  isShadowActive: false,
  isAutoCycleActive: false,
  cycleIntervalMilliseconds: 4000,

  // モザイクアート設定
  selectedSampleId: "pearl_earring",
  customImageSource: null,
  targetObjectCount: 450,
  quantizeMode: "true",
  paletteColorsCount: 8,
  retroTheme: "gameboy",
  appPhase: "idle",
  playbackSpeed: 0.5,
};

export const randomizeFilters = {
  palette: true,
  shape: true,
  physics: true,
  mode: false,
};

export const undoHistoryStack = [];
export const redoHistoryStack = [];
export const maximumHistoryLength = 40;

let stateApplierCallback = null;
let toastCallback = null;

export function setStateApplier(callback) {
  stateApplierCallback = callback;
}

export function setToastNotifier(callback) {
  toastCallback = callback;
}

export function recordStateSnapshot() {
  undoHistoryStack.push(JSON.stringify(simulationState));
  if (undoHistoryStack.length > maximumHistoryLength) {
    undoHistoryStack.shift();
  }
  redoHistoryStack.length = 0;
  updateUndoRedoButtonsState();
}

export function triggerUndoOperation() {
  if (undoHistoryStack.length === 0) return;
  redoHistoryStack.push(JSON.stringify(simulationState));
  const previousStateJson = undoHistoryStack.pop();
  if (stateApplierCallback && previousStateJson) {
    stateApplierCallback(JSON.parse(previousStateJson));
  }
  updateUndoRedoButtonsState();
  if (toastCallback) {
    toastCallback("設定を取り消しました (Undo)", "info");
  }
}

export function triggerRedoOperation() {
  if (redoHistoryStack.length === 0) return;
  undoHistoryStack.push(JSON.stringify(simulationState));
  const nextStateJson = redoHistoryStack.pop();
  if (stateApplierCallback && nextStateJson) {
    stateApplierCallback(JSON.parse(nextStateJson));
  }
  updateUndoRedoButtonsState();
  if (toastCallback) {
    toastCallback("設定をやり直しました (Redo)", "info");
  }
}

export function updateUndoRedoButtonsState() {
  const undoBtn = document.getElementById("undo-button");
  const redoBtn = document.getElementById("redo-button");
  if (undoBtn) undoBtn.disabled = undoHistoryStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoHistoryStack.length === 0;
}

export function convertHexToRgbArray(hexString) {
  let cleanHex = (hexString || "#000000").replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  const parsedNumber = Number.parseInt(cleanHex, 16);
  return [
    (parsedNumber >> 16) & 255,
    (parsedNumber >> 8) & 255,
    parsedNumber & 255,
  ];
}

export function getFormattedDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}_${m}${d}_${h}${min}${s}`;
}

export function debugLogMessage(messageTopic, detailsObject) {
  console.log(`[Cascade Studio] [${messageTopic}]:`, detailsObject);
}
