import {
  captureCanvasFrameForRecording,
  getIsCurrentlyRecording,
} from "./exporter.js";
import {
  getSmoothedPolygonVertices,
  initGpuRenderer,
  lastGpuRenderDurationMs,
  renderMosaicPiecesGpu,
} from "./gpuRenderer.js";
import {
  activeGeometricBodies,
  advanceMosaicPlayback,
  checkIsContainerFull,
  frameBottomBody,
  frameLeftBody,
  frameRightBody,
  groundPhysicsBody,
  initializePhysicsWorld,
  mosaicFrameBounds,
  physicsEngineInstance,
  physicsWorldInstance,
  updatePhysicsFloorPosition,
} from "./physics.js";
import { convertHexToRgbArray, simulationState } from "./state.js";
import { displayToastNotification } from "./ui.js";

export let p5SketchInstance = null;
export let grainTextureBuffer = null;
export let staticLayerBuffer = null;
export let isStaticLayerDirty = true;

export function markStaticLayerDirty() {
  isStaticLayerDirty = true;
}

export function initStaticLayerBuffer(p) {
  if (staticLayerBuffer) {
    staticLayerBuffer.remove();
  }
  staticLayerBuffer = p.createGraphics(
    window.innerWidth,
    window.innerHeight,
  );
  staticLayerBuffer.pixelDensity(1);
  isStaticLayerDirty = true;
}

/**
 * 起動時に1回だけ生成する軽量静的ノイズテクスチャ（毎フレームのCPUループゼロ）
 */
export function createStaticGrainTexture(p) {
  const size = 256;
  const buffer = p.createGraphics(size, size);
  buffer.loadPixels();
  for (let i = 0; i < buffer.pixels.length; i += 4) {
    const val = Math.floor(Math.random() * 255);
    buffer.pixels[i] = val;
    buffer.pixels[i + 1] = val;
    buffer.pixels[i + 2] = val;
    buffer.pixels[i + 3] = 35;
  }
  buffer.updatePixels();
  return buffer;
}

export function setP5SketchInstance(instance) {
  p5SketchInstance = instance;
}

export const sketchDefinition = (p) => {
  const frameSpawnCounter = 0;
  const isContainerFullState = false;

  p.setup = () => {
    const canvasElement = p.createCanvas(
      window.innerWidth,
      window.innerHeight,
      p.WEBGL,
    );
    canvasElement.parent("canvas-container");
    p.pixelDensity(1);
    p.frameRate(60);

    // 起動時に1回だけ静的グレインを生成（毎フレームのCPU処理なし）
    grainTextureBuffer = createStaticGrainTexture(p);
    initStaticLayerBuffer(p);

    // GPU一括バッチレンダラーの初期化 (WebGL2カスタムシェーダーパイプライン)
    initGpuRenderer(p.drawingContext);

    initializePhysicsWorld();
  };

  const recentFrameDurations = [];

  p.draw = () => {
    const frameStart = performance.now();
    const speed = simulationState.playbackSpeed || 1.0;

    // 演算は事前ベイクで完全完了しているため、実行時の物理シミュレーションは一切行わない！
    // 事前計算された完全な物理軌跡をそのまま再生（タイムライン再生）
    advanceMosaicPlayback(speed);

    p.background(simulationState.backgroundColorHex);

    p.push();
    p.translate(-p.width / 2, -p.height / 2);

    // 額縁フレームの背景（アクリルパネル）
    renderMosaicFrameBackground(p);

    if (simulationState.is3DMode) {
      renderSceneIn3D(p);
    } else {
      renderSceneIn2D(p);
    }

    // 額縁フレームの前景（アクリル外枠・光沢ハイライト）
    renderMosaicFrameForeground(p);

    if (simulationState.isDebugMode) {
      renderDebugPhysicsOverlay(p);
    }

    p.pop();

    if (simulationState.isGrainActive && grainTextureBuffer) {
      p.push();
      p.resetMatrix();
      p.noStroke();
      p.imageMode(p.CORNER);
      // 上品で自然な微細フィルムグレイン
      p.tint(255, (simulationState.grainIntensityPercent / 100) * 140);
      p.image(
        grainTextureBuffer,
        -p.width / 2,
        -p.height / 2,
        p.width,
        p.height,
      );
      p.pop();
    }

    // MP4録画セッション中は各フレームをエンコーダへ転送
    if (getIsCurrentlyRecording()) {
      captureCanvasFrameForRecording();
    }

    const frameDuration = performance.now() - frameStart;
    recentFrameDurations.push(frameDuration);
    if (recentFrameDurations.length > 60) recentFrameDurations.shift();

    // グローバルパフォーマンスメトリクス (自動計測スクリプトおよびプロファイラー用)
    const currentFps = Math.round(p.frameRate());
    window.__PERF_METRICS__ = {
      fps: currentFps,
      frameDurationMs: frameDuration,
      gpuDurationMs: lastGpuRenderDurationMs,
      totalBodies: activeGeometricBodies.length,
      visibleBodies: activeGeometricBodies.filter((b) => b.isVisible)
        .length,
      recentDurations: [...recentFrameDurations],
    };

    if (p.frameCount % 15 === 0) {
      const fpsElem = document.getElementById("fps-display");
      if (fpsElem) fpsElem.innerText = currentFps;

      const frameTimeElem = document.getElementById("frame-time-display");
      if (frameTimeElem) {
        frameTimeElem.innerText = `${frameDuration.toFixed(2)}ms`;
      }
    }
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    initStaticLayerBuffer(p);
    updatePhysicsFloorPosition();
  };
};

/**
 * 背景色の明度を判定 (ライトテーマ/ダークテーマ自動調和)
 */
export function isBrightBackground(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#"))
    return false;
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.substring(0, 2), 16) || 0;
  const g = Number.parseInt(clean.substring(2, 4), 16) || 0;
  const b = Number.parseInt(clean.substring(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55;
}

/**
 * 額縁フレームの背景（アクリルパネルバックプレート）を描画
 */
export function renderMosaicFrameBackground(p) {
  if (!mosaicFrameBounds || mosaicFrameBounds.width <= 0) return;

  const { left, top, width, height } = mosaicFrameBounds;
  const isLight = isBrightBackground(simulationState.backgroundColorHex);

  if (isLight) {
    // ライトテーマ用：上品で柔らかなアンビエントシャドウと白系アクリルパネル
    p.noStroke();
    p.fill(0, 0, 0, 30);
    p.rect(left - 8, top - 6, width + 16, height + 16, 14);

    p.fill(0, 0, 0, 15);
    p.rect(left - 4, top - 3, width + 8, height + 8, 10);

    // アクリルバックパネル (清潔なオフホワイト)
    p.fill(250, 250, 252, 235);
    p.rect(left, top, width, height, 8);
  } else {
    // ダークテーマ用：濃紺アクリルパネル
    p.noStroke();
    p.fill(0, 0, 0, 75);
    p.rect(left - 6, top - 6, width + 12, height + 12, 12);

    p.fill(10, 15, 30, 190);
    p.rect(left, top, width, height, 8);
  }
}

/**
 * 額縁フレームの前景（アクリル外枠・光沢ハイライト・台座）を描画
 */
export function renderMosaicFrameForeground(p) {
  if (!mosaicFrameBounds || mosaicFrameBounds.width <= 0) return;

  const { left, right, top, bottom, width, height } = mosaicFrameBounds;
  const isLight = isBrightBackground(simulationState.backgroundColorHex);

  p.noFill();

  if (isLight) {
    // ライトテーマ用：上質なシルバーフレームと光沢ライン
    p.stroke(100, 116, 139, 70);
    p.strokeWeight(1.5);
    p.rect(left, top, width, height, 8);

    // 内側の繊細なホワイトハイライト
    p.stroke(255, 255, 255, 180);
    p.strokeWeight(1);
    p.rect(left + 2, top + 2, width - 4, height - 4, 6);

    // 上辺のアクリル反射光沢ハイライト
    p.stroke(255, 255, 255, 240);
    p.strokeWeight(1.5);
    p.line(left + 12, top + 1, right - 12, top + 1);
  } else {
    // ダークテーマ用：ガラス風外枠
    p.stroke(255, 255, 255, 55);
    p.strokeWeight(2);
    p.rect(left, top, width, height, 8);

    p.stroke(255, 255, 255, 22);
    p.strokeWeight(1);
    p.rect(left + 3, top + 3, width - 6, height - 6, 6);

    p.stroke(255, 255, 255, 95);
    p.strokeWeight(1.5);
    p.line(left + 15, top + 1, right - 15, top + 1);
  }
}

export function renderFloorBaseline(p) {
  // 床面のビジュアル表示は削除済み
}

export function updateGrainNoiseBuffer() {
  // 静的バッファのため再生成不要
}

export function renderSceneIn2D(p) {
  const curvatureRatio = simulationState.shapeCurvaturePercent / 100;

  // 1. GPU一括バッチ描画 (WebGL2 GLSLカスタムシェーダーによる1ドローコール描画)
  const isGpuRendered = renderMosaicPiecesGpu(
    p.drawingContext,
    activeGeometricBodies,
    p.width,
    p.height,
    curvatureRatio,
  );

  if (isGpuRendered) {
    // p5.jsのシェーダー・ステートをリセットして後続の額縁前景描画との干渉を防止
    if (p.resetShader) p.resetShader();
    return;
  }

  // 2. フォールバック: WebGL2非対応等の環境用イミディエイト描画
  for (let i = 0; i < activeGeometricBodies.length; i++) {
    const body = activeGeometricBodies[i];
    if (body.isVisible === false) continue; // 未スポーン時はスキップ

    const graphicsData = body.customGraphicsData;
    if (!graphicsData) continue;

    // 視野外カリング
    if (
      body.position.y < -150 ||
      body.position.y > p.height + 150 ||
      body.position.x < -150 ||
      body.position.x > p.width + 150
    ) {
      continue;
    }

    // 頂点スムージングを1度だけ計算してキャッシュ（毎フレームのChaikin反復再計算＆大量GCを完全排除）
    if (
      !graphicsData.cachedVertices ||
      graphicsData.cachedCurvature !== curvatureRatio
    ) {
      graphicsData.cachedVertices = getSmoothedPolygonVertices(
        graphicsData.localVertices,
        curvatureRatio,
      );
      graphicsData.cachedCurvature = curvatureRatio;
    }

    const gapPercent = simulationState.pieceGapPercent ?? 12;
    const gapScale = Math.max(0.3, 1.0 - (gapPercent / 100) * 0.45);

    p.push();
    p.translate(body.position.x, body.position.y);
    p.rotate(body.angle);
    p.scale(gapScale);

    p.fill(graphicsData.fillColor);
    p.stroke(255, 255, 255, 45);
    p.strokeWeight(1.5);

    const verts = graphicsData.cachedVertices;
    p.beginShape();
    for (let v = 0; v < verts.length; v++) {
      p.vertex(verts[v].x, verts[v].y);
    }
    p.endShape(p.CLOSE);

    p.pop();
  }
}

export function renderSceneIn3D(p) {
  p.ambientLight(150);
  p.directionalLight(255, 255, 255, 0.4, 0.7, -0.6);
  p.pointLight(255, 240, 220, p.width / 2, 100, 300);
  const curvatureRatio = simulationState.shapeCurvaturePercent / 100;

  for (
    let bodyIndex = 0;
    bodyIndex < activeGeometricBodies.length;
    bodyIndex++
  ) {
    const body = activeGeometricBodies[bodyIndex];
    if (body.isVisible === false) continue; // 未スポーン時はスキップ

    // 視野外カリング
    if (
      body.position.y < -150 ||
      body.position.y > p.height + 150 ||
      body.position.x < -150 ||
      body.position.x > p.width + 150
    ) {
      continue;
    }

    const graphicsData = body.customGraphicsData;
    if (!graphicsData) continue;

    graphicsData.rotationZ3D += graphicsData.rotationSpeed3D;

    const gapPercent = simulationState.pieceGapPercent ?? 12;
    const gapScale = Math.max(0.3, 1.0 - (gapPercent / 100) * 0.45);

    p.push();
    p.translate(body.position.x, body.position.y, 0);
    p.rotateZ(body.angle);
    p.rotateX(Math.sin(graphicsData.rotationZ3D) * 0.35);
    p.rotateY(Math.cos(graphicsData.rotationZ3D) * 0.35);
    p.scale(gapScale);

    const colorRgb = convertHexToRgbArray(graphicsData.fillColor);
    p.fill(colorRgb[0], colorRgb[1], colorRgb[2]);
    p.stroke(255, 255, 255, 50);
    p.strokeWeight(1.0);

    const halfDepth = graphicsData.depth3D * 0.5;
    if (
      !graphicsData.cachedVertices ||
      graphicsData.cachedCurvature !== curvatureRatio
    ) {
      graphicsData.cachedVertices = getSmoothedPolygonVertices(
        graphicsData.localVertices,
        curvatureRatio,
      );
      graphicsData.cachedCurvature = curvatureRatio;
    }
    const renderVertices = graphicsData.cachedVertices;

    p.push();
    p.translate(0, 0, halfDepth);
    p.beginShape();
    for (let v = 0; v < renderVertices.length; v++) {
      p.vertex(renderVertices[v].x, renderVertices[v].y);
    }
    p.endShape(p.CLOSE);
    p.pop();

    p.push();
    p.translate(0, 0, -halfDepth);
    p.beginShape();
    for (let v = 0; v < renderVertices.length; v++) {
      p.vertex(renderVertices[v].x, renderVertices[v].y);
    }
    p.endShape(p.CLOSE);
    p.pop();

    p.beginShape(p.QUAD_STRIP);
    for (
      let vertexIndex = 0;
      vertexIndex <= renderVertices.length;
      vertexIndex++
    ) {
      const currentVertex =
        renderVertices[vertexIndex % renderVertices.length];
      p.vertex(currentVertex.x, currentVertex.y, halfDepth);
      p.vertex(currentVertex.x, currentVertex.y, -halfDepth);
    }
    p.endShape();

    p.pop();
  }
}

export { getSmoothedPolygonVertices };

/**
 * 有機的多角形を1周ぴったり閉じたポリゴンとして正確に描画
 */
export function drawOrganicShapeGeometry(
  p,
  vertices,
  curvature,
  offsetX,
  offsetY,
) {
  if (!vertices || vertices.length === 0) return;
  const renderVertices = getSmoothedPolygonVertices(vertices, curvature);

  p.beginShape();
  for (let i = 0; i < renderVertices.length; i++) {
    const pt = renderVertices[i];
    p.vertex(pt.x + offsetX, pt.y + offsetY);
  }
  p.endShape(p.CLOSE);
}

export function renderDebugPhysicsOverlay(p) {
  if (groundPhysicsBody) {
    p.stroke(34, 197, 94, 230);
    p.strokeWeight(2.0);
    p.noFill();
    p.beginShape();
    for (let i = 0; i < groundPhysicsBody.vertices.length; i++) {
      const v = groundPhysicsBody.vertices[i];
      p.vertex(v.x, v.y);
    }
    p.endShape(p.CLOSE);
  }

  const frameWalls = [frameBottomBody, frameLeftBody, frameRightBody];
  for (const wall of frameWalls) {
    if (wall?.vertices) {
      p.stroke(56, 189, 248, 220);
      p.strokeWeight(2.0);
      p.noFill();
      p.beginShape();
      for (let i = 0; i < wall.vertices.length; i++) {
        p.vertex(wall.vertices[i].x, wall.vertices[i].y);
      }
      p.endShape(p.CLOSE);
    }
  }

  for (
    let bodyIndex = 0;
    bodyIndex < activeGeometricBodies.length;
    bodyIndex++
  ) {
    const body = activeGeometricBodies[bodyIndex];

    p.stroke(245, 158, 11, 230);
    p.strokeWeight(1.5);
    p.noFill();
    p.beginShape();
    for (
      let vertexIndex = 0;
      vertexIndex < body.vertices.length;
      vertexIndex++
    ) {
      const vertexPoint = body.vertices[vertexIndex];
      p.vertex(vertexPoint.x, vertexPoint.y);
    }
    p.endShape(p.CLOSE);

    p.stroke(56, 189, 248, 220);
    p.strokeWeight(2);
    p.line(
      body.position.x,
      body.position.y,
      body.position.x + body.velocity.x * 4,
      body.position.y + body.velocity.y * 4,
    );
  }
}
