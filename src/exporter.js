import { colorPalettes } from "./constants/palettes.js";
import { activeGeometricBodies } from "./physics.js";
import {
  drawOrganicShapeGeometry,
  getSmoothedPolygonVertices,
  p5SketchInstance,
  renderFloorBaseline,
} from "./sketch.js";
import {
  debugLogMessage,
  getFormattedDate,
  recordStateSnapshot,
  simulationState,
  sketchTitle,
} from "./state.js";
import { displayToastNotification } from "./ui.js";

let mediaRecorderInstance = null;
let recordedVideoChunks = [];
let isCurrentlyRecording = false;
let recordingStartTime = 0;
let recordingTimerInterval = null;
let targetLoopRecordingCount = 0;
let completedLoopsCount = 0;

export function getIsCurrentlyRecording() {
  return isCurrentlyRecording;
}

/**
 * 高解像度（3840x2160）JPG画像および設定JSONを書き出し
 */
export function exportHighResolutionComposition() {
  if (!p5SketchInstance) return;
  displayToastNotification("高解像度画像をレンダリング中……", "info");

  const timestamp = getFormattedDate();
  const exportTargetWidth = 3840;
  const exportTargetHeight = 2160;
  const baseFilename = `${sketchTitle}_${timestamp}_${exportTargetWidth}x${exportTargetHeight}`;

  const exportGraphics = p5SketchInstance.createGraphics(
    exportTargetWidth,
    exportTargetHeight,
    p5SketchInstance.WEBGL,
  );
  const scaleMultiplier = exportTargetWidth / window.innerWidth;

  exportGraphics.pixelDensity(1);
  exportGraphics.background(simulationState.backgroundColorHex);

  exportGraphics.push();
  exportGraphics.translate(
    -exportTargetWidth / 2,
    -exportTargetHeight / 2,
  );
  exportGraphics.scale(scaleMultiplier);

  renderFloorBaseline(exportGraphics);

  for (
    let bodyIndex = 0;
    bodyIndex < activeGeometricBodies.length;
    bodyIndex++
  ) {
    const body = activeGeometricBodies[bodyIndex];
    const graphicsData = body.customGraphicsData;
    if (!graphicsData) continue;

    const curvatureRatio = simulationState.shapeCurvaturePercent / 100;

    exportGraphics.push();
    exportGraphics.translate(body.position.x, body.position.y);
    exportGraphics.rotate(body.angle);

    if (simulationState.isShadowActive) {
      exportGraphics.noStroke();
      exportGraphics.fill(0, 0, 0, 50);
      drawOrganicShapeGeometry(
        exportGraphics,
        graphicsData.localVertices,
        curvatureRatio,
        6,
        8,
      );
    }

    // 1. 塗りつぶしパス
    exportGraphics.noStroke();
    exportGraphics.fill(graphicsData.fillColor);
    drawOrganicShapeGeometry(
      exportGraphics,
      graphicsData.localVertices,
      curvatureRatio,
      0,
      0,
    );

    // 2. 輪郭線パス
    exportGraphics.noFill();
    exportGraphics.stroke(255, 255, 255, 40);
    exportGraphics.strokeWeight(1.5);
    drawOrganicShapeGeometry(
      exportGraphics,
      graphicsData.localVertices,
      curvatureRatio,
      0,
      0,
    );

    exportGraphics.pop();
  }
  exportGraphics.pop();

  exportGraphics.save(`${baseFilename}.jpg`);
  exportGraphics.remove();

  downloadStateJsonFile(`${baseFilename}.json`);
  displayToastNotification("高解像度画像とJSONを出力しました", "success");
  debugLogMessage("High-Res Exported", { filename: baseFilename });
}

/**
 * 純粋なベクターSVG形式で高品質書き出し（ライブラリ非互換・DOMシリアライズ不具合を完全解消）
 */
export function exportSvgComposition() {
  if (!p5SketchInstance) return;
  displayToastNotification("ベクターSVGを書き出し中……", "info");

  const timestamp = getFormattedDate();
  const exportTargetWidth = window.innerWidth;
  const exportTargetHeight = window.innerHeight;
  const baseFilename = `${sketchTitle}_${timestamp}_${exportTargetWidth}x${exportTargetHeight}`;
  const curvatureRatio = simulationState.shapeCurvaturePercent / 100;

  const svgParts = [];
  svgParts.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${exportTargetWidth}" height="${exportTargetHeight}" viewBox="0 0 ${exportTargetWidth} ${exportTargetHeight}">`,
  );

  // 1. 背景矩形
  svgParts.push(
    `  <rect width="100%" height="100%" fill="${simulationState.backgroundColorHex}" />`,
  );

  // 2. 床面描画（ビジュアル削除済み）

  // 3. 各物理幾何学図形（Chaikin角丸め適用済みの厳密な1周パス）
  for (
    let bodyIndex = 0;
    bodyIndex < activeGeometricBodies.length;
    bodyIndex++
  ) {
    const body = activeGeometricBodies[bodyIndex];
    const graphicsData = body.customGraphicsData;
    if (!graphicsData || !graphicsData.localVertices) continue;

    const smoothedVertices = getSmoothedPolygonVertices(
      graphicsData.localVertices,
      curvatureRatio,
    );
    if (!smoothedVertices || smoothedVertices.length === 0) continue;

    // SVG path d 文字列を生成 (M x y L x y ... Z)
    const pathD = `${smoothedVertices
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"} ${v.x.toFixed(2)} ${v.y.toFixed(2)}`,
      )
      .join(" ")} Z`;

    const angleDeg = ((body.angle * 180) / Math.PI).toFixed(2);
    const posX = body.position.x.toFixed(2);
    const posY = body.position.y.toFixed(2);

    svgParts.push(
      `  <g transform="translate(${posX}, ${posY}) rotate(${angleDeg})">`,
    );

    // ドロップシャドウ
    if (simulationState.isShadowActive) {
      svgParts.push(
        `    <path d="${pathD}" transform="translate(5, 7)" fill="rgba(0, 0, 0, 0.2)" />`,
      );
    }

    // 塗りつぶし
    svgParts.push(
      `    <path d="${pathD}" fill="${graphicsData.fillColor}" />`,
    );

    // 輪郭線
    svgParts.push(
      `    <path d="${pathD}" fill="none" stroke="rgba(255, 255, 255, 0.16)" stroke-width="1.5" />`,
    );

    svgParts.push("  </g>");
  }

  svgParts.push("</svg>");

  const svgContent = svgParts.join("\n");
  const svgBlob = new Blob([svgContent], {
    type: "image/svg+xml;charset=utf-8",
  });
  const downloadUrl = URL.createObjectURL(svgBlob);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.href = downloadUrl;
  downloadAnchor.download = `${baseFilename}.svg`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  document.body.removeChild(downloadAnchor);
  URL.revokeObjectURL(downloadUrl);

  displayToastNotification("SVGファイルを書き出しました", "success");
  debugLogMessage("SVG Exported", { filename: baseFilename });
}

export function downloadStateJsonFile(
  filename = `${sketchTitle}_${getFormattedDate()}.json`,
) {
  const stateExportData = {
    title: sketchTitle,
    exportDate: new Date().toISOString(),
    parameters: { ...simulationState },
    activePalette: colorPalettes[simulationState.activePaletteIndex],
    bodiesCount: activeGeometricBodies.length,
  };

  const jsonBlob = new Blob([JSON.stringify(stateExportData, null, 2)], {
    type: "application/json",
  });
  const downloadLink = document.createElement("a");
  downloadLink.href = URL.createObjectURL(jsonBlob);
  downloadLink.download = filename;
  downloadLink.click();
  URL.revokeObjectURL(downloadLink.href);
}

export function importStateFromJsonFile(fileEvent, applyCallback) {
  const selectedFile = fileEvent.target.files[0];
  if (!selectedFile) return;

  const fileReader = new FileReader();
  fileReader.onload = (event) => {
    try {
      const parsedData = JSON.parse(event.target.result);
      if (parsedData?.parameters) {
        recordStateSnapshot();
        if (applyCallback) {
          applyCallback(parsedData.parameters);
        }
        displayToastNotification(
          "設定JSONを正常に復元しました",
          "success",
        );
        debugLogMessage("State Restored from JSON", parsedData.parameters);
      } else {
        throw new Error("無効なJSON形式です");
      }
    } catch (error) {
      displayToastNotification(
        `JSONの読み込みに失敗しました: ${error.message}`,
        "warning",
      );
    }
  };
  fileReader.readAsText(selectedFile);
}

export function startCanvasVideoRecording() {
  if (isCurrentlyRecording) return;

  const canvasElement = document.querySelector("#canvas-container canvas");
  if (!canvasElement) {
    displayToastNotification("キャンバスが見つかりません", "warning");
    return;
  }

  const canvasStream = canvasElement.captureStream(60);
  recordedVideoChunks = [];

  let mimeTypeOption = "video/webm;codecs=vp9";
  if (!MediaRecorder.isTypeSupported(mimeTypeOption)) {
    mimeTypeOption = "video/webm";
  }

  try {
    mediaRecorderInstance = new MediaRecorder(canvasStream, {
      mimeType: mimeTypeOption,
      videoBitsPerSecond: 16000000,
    });
  } catch (error) {
    displayToastNotification(
      `MediaRecorderの作成に失敗しました: ${error.message}`,
      "warning",
    );
    return;
  }

  mediaRecorderInstance.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedVideoChunks.push(event.data);
    }
  };

  mediaRecorderInstance.onstop = () => {
    finishVideoRecording();
  };

  mediaRecorderInstance.start(100);
  isCurrentlyRecording = true;
  recordingStartTime = Date.now();

  const hud = document.getElementById("recording-hud");
  if (hud) hud.classList.remove("hidden");
  const startBtn = document.getElementById("record-start-button");
  if (startBtn) startBtn.disabled = true;
  const stopBtn = document.getElementById("record-stop-button");
  if (stopBtn) {
    stopBtn.disabled = false;
    stopBtn.classList.remove(
      "text-slate-500",
      "cursor-not-allowed",
      "bg-slate-800",
    );
    stopBtn.classList.add("bg-red-600", "text-white");
  }

  recordingTimerInterval = setInterval(updateRecordingTimerHUD, 100);
  displayToastNotification("録画を開始しました [Sキーで停止]", "info");
  debugLogMessage("Recording Started", { fps: 60, bitrate: "16Mbps" });
}

export function stopCanvasVideoRecording() {
  if (!isCurrentlyRecording || !mediaRecorderInstance) return;
  mediaRecorderInstance.stop();
  isCurrentlyRecording = false;
  clearInterval(recordingTimerInterval);

  const hud = document.getElementById("recording-hud");
  if (hud) hud.classList.add("hidden");
  const startBtn = document.getElementById("record-start-button");
  if (startBtn) startBtn.disabled = false;
  const stopBtn = document.getElementById("record-stop-button");
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.className =
      "py-2 px-3 rounded-lg bg-slate-800 text-slate-500 font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed";
  }
}

function finishVideoRecording() {
  const timestamp = getFormattedDate();
  const baseFilename = `${sketchTitle}_video_${timestamp}_${window.innerWidth}x${window.innerHeight}`;
  const videoBlob = new Blob(recordedVideoChunks, { type: "video/webm" });

  const videoUrl = URL.createObjectURL(videoBlob);
  const downloadLink = document.createElement("a");
  downloadLink.href = videoUrl;
  downloadLink.download = `${baseFilename}.webm`;
  downloadLink.click();
  URL.revokeObjectURL(videoUrl);

  downloadStateJsonFile(`${baseFilename}.json`);
  displayToastNotification("動画とJSONを書き出しました", "success");
  debugLogMessage("Recording Finished", { filename: baseFilename });
}

function updateRecordingTimerHUD() {
  const elapsedMilliseconds = Date.now() - recordingStartTime;
  const totalSeconds = Math.floor(elapsedMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const deciseconds = Math.floor((elapsedMilliseconds % 1000) / 100);

  const timeString = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${deciseconds}`;
  const timeElem = document.getElementById("recording-time-display");
  if (timeElem) timeElem.innerText = timeString;
}

export function startNLoopRecording(
  requestedLoopCount,
  onAutoCycleEnable,
) {
  if (isCurrentlyRecording) return;

  targetLoopRecordingCount = requestedLoopCount;
  completedLoopsCount = 0;

  if (!simulationState.isAutoCycleActive && onAutoCycleEnable) {
    onAutoCycleEnable();
  }

  startCanvasVideoRecording();
  const loopDisplay = document.getElementById("recording-loop-display");
  if (loopDisplay) {
    loopDisplay.classList.remove("hidden");
    loopDisplay.innerText = `Loop 1 / ${targetLoopRecordingCount}`;
  }
}

export function onAutoCycleLoopTick() {
  if (isCurrentlyRecording && targetLoopRecordingCount > 0) {
    completedLoopsCount++;
    const loopDisplay = document.getElementById("recording-loop-display");
    if (completedLoopsCount >= targetLoopRecordingCount) {
      stopCanvasVideoRecording();
      targetLoopRecordingCount = 0;
      if (loopDisplay) loopDisplay.classList.add("hidden");
    } else if (loopDisplay) {
      loopDisplay.innerText = `Loop ${completedLoopsCount + 1} / ${targetLoopRecordingCount}`;
    }
  }
}
