import {
  downloadStateJsonFile,
  exportHighResolutionComposition,
  exportSvgComposition,
  getIsCurrentlyRecording,
  importStateFromJsonFile,
  startCanvasVideoRecording,
  stopCanvasVideoRecording,
} from "./exporter.js";
import { SAMPLE_IMAGES, currentProcessedImage } from "./imageProcessor.js";
import {
  activeGeometricBodies,
  bakeMosaicPhysics,
  clearAllGeometricBodies,
  physicsWorldInstance,
  resetPlaybackToStart,
  skipToCompletion,
  updatePhysicsFloorPosition,
} from "./physics.js";
import { markStaticLayerDirty } from "./sketch.js";
import {
  convertHexToRgbArray,
  debugLogMessage,
  recordStateSnapshot,
  simulationState,
  triggerRedoOperation,
  triggerUndoOperation,
} from "./state.js";

const userInactivityTimer = null;
const inactivityTimeoutMilliseconds = 8000;
let isUserInterfaceCollapsed = false;
const autoCycleIntervalId = null;

export function safeAddEventListener(
  elementId,
  eventName,
  callbackHandler,
) {
  const elementNode = document.getElementById(elementId);
  if (elementNode) {
    elementNode.addEventListener(eventName, callbackHandler);
  }
}

export function displayToastNotification(
  messageText,
  notificationType = "info",
) {
  const toastElement = document.getElementById("toast-message");
  const toastTextElement = document.getElementById("toast-text");
  const toastIconElement = document.getElementById("toast-icon");
  if (!toastElement || !toastTextElement || !toastIconElement) return;

  toastTextElement.innerText = messageText;
  if (notificationType === "success") {
    toastIconElement.className =
      "fa-solid fa-circle-check text-emerald-400";
  } else if (notificationType === "warning") {
    toastIconElement.className =
      "fa-solid fa-triangle-exclamation text-amber-400";
  } else {
    toastIconElement.className = "fa-solid fa-circle-info text-sky-400";
  }

  toastElement.classList.remove("opacity-0", "translate-y-[-20px]");
  toastElement.classList.add("opacity-100", "translate-y-0");

  setTimeout(() => {
    toastElement.classList.add("opacity-0", "translate-y-[-20px]");
    toastElement.classList.remove("opacity-100", "translate-y-0");
  }, 3000);
}

export function resetUserInactivityTimer() {
  // 放置によるUI自動格納を完全に無効化
}

export function toggleUserInterfaceDrawer(collapseFlag) {
  const toolWindow = document.getElementById("tool-window");
  const toggleIcon = document.getElementById("ui-toggle-icon");
  if (!toolWindow || !toggleIcon) return;
  isUserInterfaceCollapsed =
    collapseFlag !== undefined ? collapseFlag : !isUserInterfaceCollapsed;

  if (isUserInterfaceCollapsed) {
    toolWindow.style.transform = "translateX(-100%)";
    toggleIcon.className = "fa-solid fa-bars text-sm";
  } else {
    toolWindow.style.transform = "translateX(0%)";
    toggleIcon.className = "fa-solid fa-sliders text-sm";
  }
}

export function setSimulationDisplayMode(is3D) {
  simulationState.is3DMode = is3D;
  const button2D = document.getElementById("mode-2d-button");
  const button3D = document.getElementById("mode-3d-button");
  if (!button2D || !button3D) return;

  if (is3D) {
    button3D.className =
      "flex-1 py-1.5 text-xs font-medium rounded-lg transition-all bg-sky-500 text-white shadow-sm flex items-center justify-center gap-1.5";
    button2D.className =
      "flex-1 py-1.5 text-xs font-medium rounded-lg transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5";
  } else {
    button2D.className =
      "flex-1 py-1.5 text-xs font-medium rounded-lg transition-all bg-sky-500 text-white shadow-sm flex items-center justify-center gap-1.5";
    button3D.className =
      "flex-1 py-1.5 text-xs font-medium rounded-lg transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5";
  }
}

export function setDebugDisplayMode(isDebug) {
  simulationState.isDebugMode = isDebug;
  const statusLabel = document.getElementById("debug-status-label");
  if (!statusLabel) return;
  if (isDebug) {
    statusLabel.innerText = "ON";
    statusLabel.className = "text-emerald-400";
  } else {
    statusLabel.innerText = "OFF";
    statusLabel.className = "text-amber-400";
  }
}

export function populatePaletteDropdown() {
  const dropdownElement = document.getElementById("palette-dropdown");
  if (!dropdownElement) return;
  dropdownElement.innerHTML = "";
  for (let index = 0; index < colorPalettes.length; index++) {
    const palette = colorPalettes[index];
    const optionElement = document.createElement("option");
    optionElement.value = index;
    optionElement.innerText = palette.title;
    dropdownElement.appendChild(optionElement);
  }
}

export function renderPaletteSwatches() {
  const container = document.getElementById("palette-swatches-container");
  if (!container) return;
  container.innerHTML = "";
  const currentPalette = colorPalettes[simulationState.activePaletteIndex];
  const commentElem = document.getElementById("palette-comment");
  if (commentElem) commentElem.innerText = currentPalette?.comment || "";
  if (!currentPalette?.colors) return;

  for (const colorItem of currentPalette.colors) {
    const swatchButton = document.createElement("button");
    swatchButton.className =
      "w-6 h-6 rounded-md border border-white/20 transition-transform hover:scale-110 relative group shadow-sm flex-shrink-0";
    swatchButton.style.backgroundColor = colorItem.hex;
    swatchButton.title = `${colorItem.name}: クリックで背景色に設定`;

    const activeCanvasBg = (
      simulationState.canvasBackgroundColorHex ||
      simulationState.backgroundColorHex ||
      ""
    ).toLowerCase();
    if (activeCanvasBg === colorItem.hex.toLowerCase()) {
      swatchButton.innerHTML =
        '<i class="fa-solid fa-check text-[10px] text-white drop-shadow"></i>';
    }

    swatchButton.addEventListener("click", () => {
      recordStateSnapshot();
      simulationState.canvasBackgroundColorHex = colorItem.hex;
      simulationState.backgroundColorHex = colorItem.hex;
      const canvasBgPicker = document.getElementById(
        "canvas-bg-color-picker",
      );
      if (canvasBgPicker) canvasBgPicker.value = colorItem.hex;
      const canvasBgHex = document.getElementById("canvas-bg-color-hex");
      if (canvasBgHex) canvasBgHex.innerText = colorItem.hex;
      renderPaletteSwatches();
      reapplyPaletteToExistingBodies();
      markStaticLayerDirty();
      displayToastNotification(
        `キャンバス背景色を ${colorItem.name} に設定しました`,
        "info",
      );
    });

    container.appendChild(swatchButton);
  }
}

export function updateGradientPreviewChips(baseColorHex) {
  const previewContainer = document.getElementById(
    "mono-gradient-preview",
  );
  if (!previewContainer) return;
  previewContainer.innerHTML = "";
  const rgbBase = convertHexToRgbArray(baseColorHex);
  const steps = 5;

  for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
    const factor = stepIndex / (steps - 1);
    const red = Math.min(
      255,
      Math.max(0, Math.round(rgbBase[0] * (0.35 + factor * 0.9))),
    );
    const green = Math.min(
      255,
      Math.max(0, Math.round(rgbBase[1] * (0.35 + factor * 0.9))),
    );
    const blue = Math.min(
      255,
      Math.max(0, Math.round(rgbBase[2] * (0.35 + factor * 0.9))),
    );
    const hex = `#${((1 << 24) + (red << 16) + (green << 8) + blue)
      .toString(16)
      .slice(1)
      .toUpperCase()}`;

    const stepDiv = document.createElement("div");
    stepDiv.className = "flex-1 h-full";
    stepDiv.style.backgroundColor = hex;
    previewContainer.appendChild(stepDiv);
  }
}

export function generateMonochromaticThemeFromColor(baseColorHex) {
  recordStateSnapshot();
  const rgbBase = convertHexToRgbArray(baseColorHex);
  const gradientColors = [];
  const steps = 5;

  for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
    const factor = stepIndex / (steps - 1);
    const red = Math.min(
      255,
      Math.max(0, Math.round(rgbBase[0] * (0.35 + factor * 0.9))),
    );
    const green = Math.min(
      255,
      Math.max(0, Math.round(rgbBase[1] * (0.35 + factor * 0.9))),
    );
    const blue = Math.min(
      255,
      Math.max(0, Math.round(rgbBase[2] * (0.35 + factor * 0.9))),
    );
    const hexCode = `#${((1 << 24) + (red << 16) + (green << 8) + blue)
      .toString(16)
      .slice(1)
      .toUpperCase()}`;

    gradientColors.push({
      name: `Tone ${stepIndex + 1}`,
      hex: hexCode,
      rgb: [red, green, blue],
    });
  }

  const dynamicPalette = {
    title: `Mono Gradient (${baseColorHex})`,
    comment: "自動生成グラデーション",
    colors: gradientColors,
  };

  colorPalettes.push(dynamicPalette);
  simulationState.activePaletteIndex = colorPalettes.length - 1;
  simulationState.canvasBackgroundColorHex = gradientColors[0].hex;
  simulationState.backgroundColorHex = gradientColors[0].hex;

  populatePaletteDropdown();
  const dropdown = document.getElementById("palette-dropdown");
  if (dropdown) dropdown.value = simulationState.activePaletteIndex;
  renderPaletteSwatches();

  const canvasBgPicker = document.getElementById("canvas-bg-color-picker");
  if (canvasBgPicker) {
    canvasBgPicker.value = simulationState.canvasBackgroundColorHex;
  }
  const canvasBgHex = document.getElementById("canvas-bg-color-hex");
  if (canvasBgHex) {
    canvasBgHex.innerText = simulationState.canvasBackgroundColorHex;
  }

  reapplyPaletteToExistingBodies();
  markStaticLayerDirty();
  displayToastNotification("単色グラデーションを適用しました", "success");
}

/* =========================================================================
   モザイク画像・ドット絵機能 (新機能の統合)
   ========================================================================= */

function populateMosaicSampleDropdown() {
  const dropdown = document.getElementById("mosaic-sample-dropdown");
  if (!dropdown) return;
  dropdown.innerHTML = "";

  for (const sample of SAMPLE_IMAGES) {
    const opt = document.createElement("option");
    opt.value = sample.id;
    opt.innerText = `${sample.title} (${sample.artist.split(" (")[0]})`;
    dropdown.appendChild(opt);
  }

  if (simulationState.selectedSampleId) {
    dropdown.value = simulationState.selectedSampleId;
  }
}

export async function loadMosaicSample(sampleId) {
  const sample = SAMPLE_IMAGES.find((s) => s.id === sampleId);
  if (!sample) return;

  const dropdown = document.getElementById("mosaic-sample-dropdown");
  if (dropdown) dropdown.value = sampleId;

  displayToastNotification(`${sample.title} をロード中...`, "info");
  try {
    await currentProcessedImage.loadImageSource(sample.url);
    await runMosaicProcessAndBake();
  } catch (err) {
    console.error(err);
    displayToastNotification("画像の読み込みに失敗しました", "warning");
  }
}

export async function runMosaicProcessAndBake() {
  if (!currentProcessedImage.sourceImage) return;

  const activeBadge = document.getElementById("mosaic-active-badge");
  if (activeBadge) activeBadge.innerText = "CALCULATING...";

  const progressOverlay = document.getElementById(
    "mosaic-progress-overlay",
  );
  const progressBar = document.getElementById("mosaic-progress-bar");
  const progressPercent = document.getElementById(
    "mosaic-progress-percent",
  );
  const progressPhase = document.getElementById("mosaic-progress-phase");
  const progressCount = document.getElementById("mosaic-progress-count");

  const inlineProgress = document.getElementById("mosaic-inline-progress");
  const inlineBar = document.getElementById("mosaic-inline-bar");
  const inlinePercent = document.getElementById("mosaic-inline-percent");
  const inlineText = document.getElementById("mosaic-inline-text");

  if (progressOverlay) progressOverlay.classList.remove("hidden");
  if (inlineProgress) inlineProgress.classList.remove("hidden");

  const formatPercent = (val) => {
    const num = typeof val === "number" ? val : Number.parseFloat(val);
    if (Number.isNaN(num)) return "0.000";
    return num.toFixed(3);
  };

  const setProgressState = (pct, phase, countStr = "") => {
    const formattedPct = formatPercent(pct);
    const widthVal =
      typeof pct === "number" ? Math.min(100, Math.max(0, pct)) : pct;

    if (progressBar) progressBar.style.width = `${widthVal}%`;
    if (progressPercent) progressPercent.innerText = `${formattedPct}%`;
    if (progressPhase) progressPhase.innerText = phase;
    if (progressCount && countStr) progressCount.innerText = countStr;

    if (inlineBar) inlineBar.style.width = `${widthVal}%`;
    if (inlinePercent) inlinePercent.innerText = `${formattedPct}%`;
    if (inlineText) inlineText.innerText = phase;
  };

  setProgressState(5.0, "画像を解析中...");
  await new Promise((r) => setTimeout(r, 10));

  currentProcessedImage.process({
    targetObjectCount: simulationState.targetObjectCount || 450,
    quantizeMode: simulationState.quantizeMode,
    paletteColorsCount: simulationState.paletteColorsCount,
    retroTheme: simulationState.retroTheme,
  });

  updateMosaicPreviewUI();

  // 物理ベイクの開始（進捗コールバックでプログレスバーを更新）
  await bakeMosaicPhysics((p) => {
    setProgressState(
      p.percent,
      p.phaseText,
      `${p.spawnedCount} / ${p.totalCount}`,
    );
  });

  if (activeBadge) activeBadge.innerText = "ACTIVE";

  setProgressState(100.0, "完了！モザイク降下開始");

  setTimeout(() => {
    if (progressOverlay) progressOverlay.classList.add("hidden");
    if (inlineProgress) inlineProgress.classList.add("hidden");
  }, 350);

  displayToastNotification(
    "モザイク座標計算完了！図形が降ってきます",
    "success",
  );
}

function updateMosaicPreviewUI() {
  const container = document.getElementById("mosaic-preview-container");
  if (!container) return;
  container.innerHTML = "";
  if (currentProcessedImage.previewCanvas) {
    currentProcessedImage.previewCanvas.className =
      "w-full h-full object-contain";
    container.appendChild(currentProcessedImage.previewCanvas);
  }
  const badge = document.getElementById("mosaic-grid-badge");
  if (badge) {
    badge.innerText = `${currentProcessedImage.gridWidth}×${currentProcessedImage.gridHeight}`;
  }
}

/* =========================================================================
   UIイベントリスナー設定 (元の機能完全網羅 + モザイク連携)
   ========================================================================= */

export function setupUIEventListeners() {
  // モザイクサンプルドロップダウンの初期化
  populateMosaicSampleDropdown();
  safeAddEventListener("mosaic-sample-dropdown", "change", async (e) => {
    simulationState.selectedSampleId = e.target.value;
    await loadMosaicSample(e.target.value);
  });

  // 手持ち画像アップロード
  safeAddEventListener("mosaic-custom-input", "change", (e) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          displayToastNotification("画像をデコード中...", "info");
          await currentProcessedImage.loadImageSource(ev.target.result);

          // ドロップダウンにカスタム画像項目を追加または選択
          const dropdown = document.getElementById(
            "mosaic-sample-dropdown",
          );
          if (dropdown) {
            let customOpt = dropdown.querySelector(
              'option[value="custom_upload"]',
            );
            if (!customOpt) {
              customOpt = document.createElement("option");
              customOpt.value = "custom_upload";
              customOpt.innerText = `カスタム画像 (${file.name})`;
              dropdown.insertBefore(customOpt, dropdown.firstChild);
            } else {
              customOpt.innerText = `カスタム画像 (${file.name})`;
            }
            dropdown.value = "custom_upload";
            simulationState.selectedSampleId = "custom_upload";
          }

          await runMosaicProcessAndBake();
          displayToastNotification(
            "画像を読み込みモザイクを生成しました",
            "success",
          );
        } catch (err) {
          console.error(err);
          displayToastNotification("画像処理に失敗しました", "warning");
        }
      };
      reader.readAsDataURL(file);
    }
  });

  // 減色モード切り替え
  safeAddEventListener("quantize-mode-select", "change", async (e) => {
    simulationState.quantizeMode = e.target.value;
    await runMosaicProcessAndBake();
  });

  // パレット色数スライダー
  safeAddEventListener("quantize-colors-slider", "input", (e) => {
    simulationState.paletteColorsCount = Number.parseInt(
      e.target.value,
      10,
    );
    const valElem = document.getElementById("quantize-colors-val");
    if (valElem) valElem.innerText = e.target.value;
  });
  safeAddEventListener("quantize-colors-slider", "change", () => {
    runMosaicProcessAndBake();
  });

  // モザイク操作ボタン
  safeAddEventListener("mosaic-replay-btn", "click", () => {
    resetPlaybackToStart();
    displayToastNotification("モザイクを最初から降らせます", "info");
  });
  safeAddEventListener("mosaic-skip-btn", "click", () => {
    skipToCompletion();
  });

  // 再生速度 (倍速) 切替
  const speedButtons = document.querySelectorAll(
    "#playback-speed-group .speed-btn",
  );
  for (const btn of speedButtons) {
    btn.addEventListener("click", () => {
      const speed = Number.parseFloat(btn.dataset.speed || "1");
      simulationState.playbackSpeed = speed;
      for (const b of speedButtons) {
        if (b === btn) {
          b.className =
            "speed-btn px-2 py-0.5 rounded text-[10px] font-medium transition bg-sky-500 text-white shadow-sm";
        } else {
          b.className =
            "speed-btn px-2 py-0.5 rounded text-[10px] font-medium transition text-slate-600 hover:text-slate-900";
        }
      }
      displayToastNotification(
        `再生速度を ${speed}x に設定しました`,
        "info",
      );
    });
  }

  // UI開閉ボタン
  safeAddEventListener("ui-toggle-button", "click", () => {
    toggleUserInterfaceDrawer();
  });

  // 2D / 3D Mode 切替
  safeAddEventListener("mode-2d-button", "click", () => {
    setSimulationDisplayMode(false);
  });
  safeAddEventListener("mode-3d-button", "click", () => {
    setSimulationDisplayMode(true);
  });

  // デバッグ切替
  safeAddEventListener("debug-toggle-button", "click", () => {
    setDebugDisplayMode(!simulationState.isDebugMode);
  });

  // Undo / Redo
  safeAddEventListener("undo-button", "click", triggerUndoOperation);
  safeAddEventListener("redo-button", "click", triggerRedoOperation);

  // 図形基本サイズ
  safeAddEventListener("shape-size-slider", "input", (e) => {
    simulationState.shapeBaseRadius = Number.parseInt(e.target.value, 10);
    const valElem = document.getElementById("shape-size-val");
    if (valElem) valElem.innerText = e.target.value;
  });
  safeAddEventListener("shape-size-slider", "change", () => {
    runMosaicProcessAndBake();
  });

  // サイズばらつき度
  safeAddEventListener("shape-size-variation-slider", "input", (e) => {
    simulationState.shapeSizeVariationPercent = Number.parseInt(
      e.target.value,
      10,
    );
    const valElem = document.getElementById("shape-size-variation-val");
    if (valElem) valElem.innerText = `${e.target.value}%`;
  });
  safeAddEventListener("shape-size-variation-slider", "change", () => {
    runMosaicProcessAndBake();
  });

  // 多角形頂点数
  safeAddEventListener("shape-vertex-slider", "input", (e) => {
    simulationState.shapeVertexCount = Number.parseInt(e.target.value, 10);
    const valElem = document.getElementById("shape-vertex-val");
    if (valElem) valElem.innerText = e.target.value;
  });
  safeAddEventListener("shape-vertex-slider", "change", () => {
    runMosaicProcessAndBake();
  });

  // 角の丸み・有機度
  safeAddEventListener("shape-curve-slider", "input", (e) => {
    simulationState.shapeCurvaturePercent = Number.parseInt(
      e.target.value,
      10,
    );
    const valElem = document.getElementById("shape-curve-val");
    if (valElem) valElem.innerText = `${e.target.value}%`;
  });
  safeAddEventListener("shape-curve-slider", "change", () => {
    runMosaicProcessAndBake();
  });

  // 重力加速度
  safeAddEventListener("gravity-slider", "input", (e) => {
    const val = Number.parseInt(e.target.value, 10) / 10;
    simulationState.gravityForce = val;
    if (physicsWorldInstance) physicsWorldInstance.gravity.y = val;
    const valElem = document.getElementById("gravity-val");
    if (valElem) valElem.innerText = val.toFixed(1);
  });
  safeAddEventListener("gravity-slider", "change", () => {
    runMosaicProcessAndBake();
  });

  // 反発係数
  safeAddEventListener("restitution-slider", "input", (e) => {
    const val = Number.parseInt(e.target.value, 10) / 100;
    simulationState.restitutionCoeff = val;
    const valElem = document.getElementById("restitution-val");
    if (valElem) valElem.innerText = val.toFixed(2);
  });
  safeAddEventListener("restitution-slider", "change", () => {
    runMosaicProcessAndBake();
  });

  // ピースの隙間 (目地) - リアルタイム反映
  safeAddEventListener("piece-gap-slider", "input", (e) => {
    const val = Number.parseInt(e.target.value, 10);
    simulationState.pieceGapPercent = val;
    const valElem = document.getElementById("piece-gap-val");
    if (valElem) valElem.innerText = `${val}%`;
    markStaticLayerDirty();
  });

  // 正弦波スイング投入
  safeAddEventListener("sine-wave-spawn-toggle", "change", (e) => {
    simulationState.isSineWaveSpawnActive = e.target.checked;
    runMosaicProcessAndBake();
  });

  // 背景色ピッカー
  // ページ背景色ピッカー
  safeAddEventListener("page-bg-color-picker", "input", (e) => {
    simulationState.pageBackgroundColorHex = e.target.value;
    simulationState.backgroundColorHex = e.target.value;
    const hexElem = document.getElementById("page-bg-color-hex");
    if (hexElem) hexElem.innerText = e.target.value;
    document.body.style.backgroundColor = e.target.value;
    markStaticLayerDirty();
  });

  // キャンバス背景色ピッカー
  safeAddEventListener("canvas-bg-color-picker", "input", (e) => {
    simulationState.canvasBackgroundColorHex = e.target.value;
    const hexElem = document.getElementById("canvas-bg-color-hex");
    if (hexElem) hexElem.innerText = e.target.value;
    markStaticLayerDirty();
  });

  // ピース輪郭線 (フチ)
  safeAddEventListener("piece-borders-checkbox", "change", (e) => {
    simulationState.showPieceBorders = e.target.checked;
    markStaticLayerDirty();
  });

  // フィルムグレインノイズ
  safeAddEventListener("grain-checkbox", "change", (e) => {
    simulationState.isGrainActive = e.target.checked;
  });
  safeAddEventListener("grain-slider", "input", (e) => {
    simulationState.grainIntensityPercent = Number.parseInt(
      e.target.value,
      10,
    );
    const valElem = document.getElementById("grain-val");
    if (valElem) valElem.innerText = `${e.target.value}%`;
  });

  // ドロップシャドウ
  safeAddEventListener("shadow-checkbox", "change", (e) => {
    simulationState.isShadowActive = e.target.checked;
  });

  // 録画フレーミング選択
  safeAddEventListener("recording-framing-select", "change", (e) => {
    simulationState.recordingFramingMode = e.target.value;
  });

  // 録画系
  safeAddEventListener("record-start-button", "click", () => {
    startCanvasVideoRecording();
  });
  safeAddEventListener("record-stop-button", "click", () => {
    stopCanvasVideoRecording();
  });

  // エクスポート系
  safeAddEventListener(
    "export-hires-image-button",
    "click",
    exportHighResolutionComposition,
  );
  safeAddEventListener("export-svg-button", "click", exportSvgComposition);
  safeAddEventListener(
    "export-json-button",
    "click",
    downloadStateJsonFile,
  );
  safeAddEventListener("import-json-input", "change", (e) => {
    if (e.target.files?.[0]) {
      importStateFromJsonFile(e.target.files[0]);
    }
  });

  // 初回サンプル（真珠の耳飾りの少女）をロード
  loadMosaicSample("pearl_earring");
}

export function applyStateFromJsonObject(stateObj) {
  Object.assign(simulationState, stateObj);
  setSimulationDisplayMode(simulationState.is3DMode);
  setDebugDisplayMode(simulationState.isDebugMode);
  updatePhysicsFloorPosition();
  markStaticLayerDirty();

  const currentSpeed = simulationState.playbackSpeed || 1.0;
  const speedButtons = document.querySelectorAll(
    "#playback-speed-group .speed-btn",
  );
  for (const b of speedButtons) {
    const s = Number.parseFloat(b.dataset.speed || "1");
    if (Math.abs(s - currentSpeed) < 0.01) {
      b.className =
        "speed-btn px-2 py-0.5 rounded text-[10px] font-medium transition bg-sky-500 text-white shadow-sm";
    } else {
      b.className =
        "speed-btn px-2 py-0.5 rounded text-[10px] font-medium transition text-slate-600 hover:text-slate-900";
    }
  }

  const sSlider = document.getElementById("shape-size-slider");
  if (sSlider && simulationState.shapeBaseRadius) {
    sSlider.value = simulationState.shapeBaseRadius;
    const sVal = document.getElementById("shape-size-val");
    if (sVal) sVal.innerText = simulationState.shapeBaseRadius;
  }

  const sineToggle = document.getElementById("sine-wave-spawn-toggle");
  if (sineToggle && simulationState.isSineWaveSpawnActive !== undefined) {
    sineToggle.checked = simulationState.isSineWaveSpawnActive;
  }

  const gapSlider = document.getElementById("piece-gap-slider");
  if (gapSlider && simulationState.pieceGapPercent !== undefined) {
    gapSlider.value = simulationState.pieceGapPercent;
    const gVal = document.getElementById("piece-gap-val");
    if (gVal) gVal.innerText = `${simulationState.pieceGapPercent}%`;
  }

  const borderToggle = document.getElementById("piece-borders-checkbox");
  if (borderToggle && simulationState.showPieceBorders !== undefined) {
    borderToggle.checked = simulationState.showPieceBorders;
  }

  if (simulationState.pageBackgroundColorHex) {
    const pagePicker = document.getElementById("page-bg-color-picker");
    if (pagePicker)
      pagePicker.value = simulationState.pageBackgroundColorHex;
    const pageHex = document.getElementById("page-bg-color-hex");
    if (pageHex)
      pageHex.innerText = simulationState.pageBackgroundColorHex;
    document.body.style.backgroundColor =
      simulationState.pageBackgroundColorHex;
  }
  if (simulationState.canvasBackgroundColorHex) {
    const canvasPicker = document.getElementById("canvas-bg-color-picker");
    if (canvasPicker)
      canvasPicker.value = simulationState.canvasBackgroundColorHex;
    const canvasHex = document.getElementById("canvas-bg-color-hex");
    if (canvasHex)
      canvasHex.innerText = simulationState.canvasBackgroundColorHex;
  }
  const framingSelect = document.getElementById(
    "recording-framing-select",
  );
  if (framingSelect && simulationState.recordingFramingMode) {
    framingSelect.value = simulationState.recordingFramingMode;
  }
}
