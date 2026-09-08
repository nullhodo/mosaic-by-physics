import { ArrayBufferTarget, Muxer } from "mp4-muxer";
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

let isCurrentlyRecording = false;
let recordingStartTime = 0;
let recordingTimerInterval = null;
let targetLoopRecordingCount = 0;
let completedLoopsCount = 0;

let mp4MuxerInstance = null;
let videoEncoderInstance = null;
let recordedFrameCount = 0;
let recordingCanvasElement = null;

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
  const canvasBg =
    simulationState.canvasBackgroundColorHex ||
    simulationState.backgroundColorHex ||
    "#f8f9fa";
  exportGraphics.background(canvasBg);

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

    const gapPercent = simulationState.pieceGapPercent ?? 12;
    const gapScale = Math.max(0.3, 1.0 - (gapPercent / 100) * 0.45);

    exportGraphics.push();
    exportGraphics.translate(body.position.x, body.position.y);
    exportGraphics.rotate(body.angle);
    exportGraphics.scale(gapScale);

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
    if (simulationState.showPieceBorders !== false) {
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
    }

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

  const canvasBg =
    simulationState.canvasBackgroundColorHex ||
    simulationState.backgroundColorHex ||
    "#f8f9fa";

  // 1. 背景矩形
  svgParts.push(
    `  <rect width="100%" height="100%" fill="${canvasBg}" />`,
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

    const gapPercent = simulationState.pieceGapPercent ?? 12;
    const gapScale = Math.max(
      0.3,
      1.0 - (gapPercent / 100) * 0.45,
    ).toFixed(3);

    svgParts.push(
      `  <g transform="translate(${posX}, ${posY}) rotate(${angleDeg}) scale(${gapScale})">`,
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
    if (simulationState.showPieceBorders !== false) {
      svgParts.push(
        `    <path d="${pathD}" fill="none" stroke="rgba(255, 255, 255, 0.16)" stroke-width="1.5" />`,
      );
    }

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

  if (typeof VideoEncoder === "undefined") {
    displayToastNotification(
      "お使いのブラウザはMP4 (WebCodecs) エンコードに対応していません",
      "warning",
    );
    return;
  }

  // H.264 (AVC) は偶数解像度 (2の倍数) が必須
  const width = Math.floor(canvasElement.width / 2) * 2;
  const height = Math.floor(canvasElement.height / 2) * 2;
  const fps = 60;
  const bitrate = 16_000_000;

  try {
    mp4MuxerInstance = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: "avc",
        width,
        height,
        frameRate: fps,
      },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    videoEncoderInstance = new VideoEncoder({
      output: (chunk, meta) => {
        if (mp4MuxerInstance) {
          mp4MuxerInstance.addVideoChunk(chunk, meta);
        }
      },
      error: (e) => {
        console.error("VideoEncoder error:", e);
        displayToastNotification(
          `エンコードエラー: ${e.message}`,
          "warning",
        );
      },
    });

    videoEncoderInstance.configure({
      codec: "avc1.420028", // Baseline Profile Level 4.0
      width,
      height,
      bitrate,
      framerate: fps,
    });

    recordingCanvasElement = canvasElement;
    recordedFrameCount = 0;
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
        "text-slate-400",
        "cursor-not-allowed",
        "bg-slate-100",
      );
      stopBtn.classList.add("bg-red-500", "text-white");
    }

    recordingTimerInterval = setInterval(updateRecordingTimerHUD, 100);
    displayToastNotification(
      "MP4録画を開始しました [Sキーで停止]",
      "info",
    );
    debugLogMessage("MP4 Recording Started", {
      width,
      height,
      fps,
      bitrate,
    });
  } catch (error) {
    console.error("MP4 recording initialization error:", error);
    displayToastNotification(
      `MP4録画の開始に失敗しました: ${error.message}`,
      "warning",
    );
  }
}

/**
 * 毎フレームのキャンバス描画をWebCodecsエンコーダへ転送 (sketch.jsのdraw末尾から呼び出し)
 */
export function captureCanvasFrameForRecording() {
  if (
    !isCurrentlyRecording ||
    !videoEncoderInstance ||
    !recordingCanvasElement ||
    videoEncoderInstance.state !== "configured"
  ) {
    return;
  }

  // エンコーダバックログ過多時の安全保護
  if (videoEncoderInstance.encodeQueueSize > 12) return;

  const width = Math.floor(recordingCanvasElement.width / 2) * 2;
  const height = Math.floor(recordingCanvasElement.height / 2) * 2;
  const timestampUs = Math.round((recordedFrameCount * 1_000_000) / 60);

  try {
    const videoFrame = new VideoFrame(recordingCanvasElement, {
      timestamp: timestampUs,
      visibleRect: { x: 0, y: 0, width, height },
    });
    const isKeyframe = recordedFrameCount % 120 === 0; // 2秒おきにキーフレーム
    videoEncoderInstance.encode(videoFrame, { keyFrame: isKeyframe });
    videoFrame.close();
    recordedFrameCount++;
  } catch (error) {
    console.warn("VideoFrame capture failed:", error);
  }
}

export async function stopCanvasVideoRecording() {
  if (!isCurrentlyRecording) return;
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
      "py-2 px-3 rounded-lg bg-slate-100 text-slate-400 font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed";
  }

  displayToastNotification("MP4動画をエンコード・生成中……", "info");

  try {
    if (
      videoEncoderInstance &&
      videoEncoderInstance.state === "configured"
    ) {
      await videoEncoderInstance.flush();
      videoEncoderInstance.close();
      videoEncoderInstance = null;
    }

    if (mp4MuxerInstance) {
      mp4MuxerInstance.finalize();
      const { buffer } = mp4MuxerInstance.target;
      const mp4Blob = new Blob([buffer], { type: "video/mp4" });

      const timestamp = getFormattedDate();
      const baseFilename = `${sketchTitle}_video_${timestamp}`;

      const videoUrl = URL.createObjectURL(mp4Blob);
      const downloadLink = document.createElement("a");
      downloadLink.href = videoUrl;
      downloadLink.download = `${baseFilename}.mp4`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(videoUrl);

      downloadStateJsonFile(`${baseFilename}.json`);
      displayToastNotification(
        "MP4動画と設定JSONを書き出しました",
        "success",
      );
      debugLogMessage("MP4 Exported", {
        filename: `${baseFilename}.mp4`,
        frames: recordedFrameCount,
      });
      mp4MuxerInstance = null;
      recordingCanvasElement = null;
    }
  } catch (error) {
    console.error("MP4 finalization failed:", error);
    displayToastNotification(
      `MP4書き出しに失敗しました: ${error.message}`,
      "warning",
    );
  }
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
