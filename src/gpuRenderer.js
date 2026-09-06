import { simulationState } from "./state.js";

/**
 * 凸多角形の角を曲率に応じて有機的かつ正確に丸めるChaikinアルゴリズム
 * (大サイズでも角ばらない高精度な多重反復スムージング)
 */
export function getSmoothedPolygonVertices(vertices, curvatureRatio) {
  if (!vertices || vertices.length < 3) return vertices || [];
  if (curvatureRatio <= 0.03) return vertices;

  // 曲率 0〜1 に応じて切削比率を 0.05〜0.25 に設定
  const cutRatio = Math.min(0.25, Math.max(0.05, curvatureRatio * 0.25));
  let currentPoints = vertices;

  // 4回の反復により、大サイズ（高解像度）でも角ばりが一切ないシルキースムースな曲線を生成
  const iterations = 4;
  for (let iter = 0; iter < iterations; iter++) {
    const nextPoints = [];
    const len = currentPoints.length;
    for (let i = 0; i < len; i++) {
      const p1 = currentPoints[i];
      const p2 = currentPoints[(i + 1) % len];

      const q = {
        x: (1 - cutRatio) * p1.x + cutRatio * p2.x,
        y: (1 - cutRatio) * p1.y + cutRatio * p2.y,
      };
      const r = {
        x: cutRatio * p1.x + (1 - cutRatio) * p2.x,
        y: cutRatio * p1.y + (1 - cutRatio) * p2.y,
      };

      nextPoints.push(q, r);
    }
    currentPoints = nextPoints;
  }

  return currentPoints;
}

// 最大ピース数および頂点バッファの容量設定
const MAX_PIECES = 2500;
const MAX_VERTS_PER_PIECE = 96; // Chaikinスムージング後の最大頂点数(約64〜80)に対応
const FLOATS_PER_VERTEX = 6; // x, y, r, g, b, a

// 再利用可能な頂点データプール (毎フレームのGCゼロ化)
const MAX_FILL_FLOATS =
  MAX_PIECES * MAX_VERTS_PER_PIECE * 3 * FLOATS_PER_VERTEX;
const MAX_LINE_FLOATS =
  MAX_PIECES * MAX_VERTS_PER_PIECE * 2 * FLOATS_PER_VERTEX;

let fillVertexArray = null;
let lineVertexArray = null;

let glProgram = null;
let uResolutionLocation = null;
let aPositionLocation = -1;
let aColorLocation = -1;

let fillVao = null;
let fillVbo = null;
let lineVao = null;
let lineVbo = null;
let isGpuRendererInitialized = false;
export let lastGpuRenderDurationMs = 0;

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 a_position;
in vec4 a_color;

uniform vec2 u_resolution;

out vec4 v_color;

void main() {
  // スクリーン座標 (0,0)-(width,height) を WebGLクリップ空間 (-1,1) に変換
  vec2 zeroToOne = a_position / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_color = a_color;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

in vec4 v_color;
out vec4 outColor;

void main() {
  outColor = v_color;
}
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`GPU Shader Compile Error: ${info}`);
  }
  return shader;
}

/**
 * WebGL2コンテキストを用いてGPU一括レンダラーを初期化
 */
export function initGpuRenderer(gl) {
  if (!gl) return false;

  try {
    const vertShader = createShader(
      gl,
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
    );
    const fragShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE,
    );

    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vertShader);
    gl.attachShader(glProgram, fragShader);
    gl.linkProgram(glProgram);

    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(glProgram);
      throw new Error(`GPU Program Link Error: ${info}`);
    }

    uResolutionLocation = gl.getUniformLocation(glProgram, "u_resolution");
    aPositionLocation = gl.getAttribLocation(glProgram, "a_position");
    aColorLocation = gl.getAttribLocation(glProgram, "a_color");

    // メモリプールを確保
    fillVertexArray = new Float32Array(MAX_FILL_FLOATS);
    lineVertexArray = new Float32Array(MAX_LINE_FLOATS);

    const stride = FLOATS_PER_VERTEX * 4; // 6 floats * 4 bytes = 24 bytes

    // 1. 塗りつぶし用 VAO / VBO
    fillVao = gl.createVertexArray();
    gl.bindVertexArray(fillVao);
    fillVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fillVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      fillVertexArray.byteLength,
      gl.DYNAMIC_DRAW,
    );

    gl.enableVertexAttribArray(aPositionLocation);
    gl.vertexAttribPointer(
      aPositionLocation,
      2,
      gl.FLOAT,
      false,
      stride,
      0,
    );

    gl.enableVertexAttribArray(aColorLocation);
    gl.vertexAttribPointer(
      aColorLocation,
      4,
      gl.FLOAT,
      false,
      stride,
      2 * 4,
    );

    // 2. 輪郭線用 VAO / VBO
    lineVao = gl.createVertexArray();
    gl.bindVertexArray(lineVao);
    lineVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      lineVertexArray.byteLength,
      gl.DYNAMIC_DRAW,
    );

    gl.enableVertexAttribArray(aPositionLocation);
    gl.vertexAttribPointer(
      aPositionLocation,
      2,
      gl.FLOAT,
      false,
      stride,
      0,
    );

    gl.enableVertexAttribArray(aColorLocation);
    gl.vertexAttribPointer(
      aColorLocation,
      4,
      gl.FLOAT,
      false,
      stride,
      2 * 4,
    );

    // クリーンアップ
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    isGpuRendererInitialized = true;
    console.log(
      "[GPU Renderer] Initialized successfully with WebGL2 instanced/batched pipeline.",
    );
    return true;
  } catch (err) {
    console.warn(
      "[GPU Renderer] Failed to initialize GPU renderer, falling back to standard pipeline:",
      err,
    );
    isGpuRendererInitialized = false;
    return false;
  }
}

/**
 * ピースの幾何データ（三角形ファンおよび輪郭線）を事前生成・キャッシュ
 */
export function cachePieceBatchGeometry(body, curvatureRatio) {
  const graphicsData = body.customGraphicsData;
  if (!graphicsData) return;

  if (
    !graphicsData.cachedVertices ||
    graphicsData.cachedCurvature !== curvatureRatio
  ) {
    graphicsData.cachedVertices = getSmoothedPolygonVertices(
      graphicsData.localVertices,
      curvatureRatio,
    );
    graphicsData.cachedCurvature = curvatureRatio;
    graphicsData.localTriangles = null;
    graphicsData.localEdges = null;
  }

  // 16進数カラーをRGBA（0.0〜1.0）としてキャッシュ（毎フレームの文字列解析をゼロ化）
  if (!graphicsData.cachedRgba && graphicsData.fillColor) {
    const hex = graphicsData.fillColor;
    if (hex.startsWith("#") && hex.length >= 7) {
      graphicsData.cachedRgba = [
        Number.parseInt(hex.slice(1, 3), 16) / 255,
        Number.parseInt(hex.slice(3, 5), 16) / 255,
        Number.parseInt(hex.slice(5, 7), 16) / 255,
        1.0,
      ];
    } else {
      graphicsData.cachedRgba = [1.0, 1.0, 1.0, 1.0];
    }
  }

  if (!graphicsData.localTriangles) {
    const verts = graphicsData.cachedVertices;
    const n = verts.length;
    if (n < 3) return;

    // 中心点 (0, 0) を起点とした扇形（Fan）三角形分割
    // 三角形ごとに [x0, y0, x1, y1, x2, y2]
    const triangles = [];
    for (let i = 0; i < n; i++) {
      const v1 = verts[i];
      const v2 = verts[(i + 1) % n];
      triangles.push(0, 0, v1.x, v1.y, v2.x, v2.y);
    }
    graphicsData.localTriangles = new Float32Array(triangles);

    // 外周エッジ線分 [x1, y1, x2, y2]
    const edges = [];
    for (let i = 0; i < n; i++) {
      const v1 = verts[i];
      const v2 = verts[(i + 1) % n];
      edges.push(v1.x, v1.y, v2.x, v2.y);
    }
    graphicsData.localEdges = new Float32Array(edges);
  }
}

/**
 * 全モザイクピースをGPU一括バッチレンダリング
 * (1回のドローコールで全ピースをGPU並列描画)
 */
export function renderMosaicPiecesGpu(
  gl,
  bodies,
  screenWidth,
  screenHeight,
  curvatureRatio,
) {
  if (!isGpuRendererInitialized || !gl || !glProgram) {
    return false;
  }

  const startTime = performance.now();
  let fillOffset = 0;
  let lineOffset = 0;

  // ピースの輪郭線カラー (微細な白半透明)
  const lineR = 1.0;
  const lineG = 1.0;
  const lineB = 1.0;
  const lineA = 0.18;

  const totalBodies = bodies.length;

  for (let i = 0; i < totalBodies; i++) {
    const body = bodies[i];
    if (body.isVisible === false) continue;

    const posX = body.position.x;
    const posY = body.position.y;

    // 視野外カリング
    if (
      posY < -150 ||
      posY > screenHeight + 150 ||
      posX < -150 ||
      posX > screenWidth + 150
    ) {
      continue;
    }

    const graphicsData = body.customGraphicsData;
    if (!graphicsData) continue;

    if (
      !graphicsData.localTriangles ||
      graphicsData.cachedCurvature !== curvatureRatio
    ) {
      cachePieceBatchGeometry(body, curvatureRatio);
    }

    const localTriangles = graphicsData.localTriangles;
    const localEdges = graphicsData.localEdges;
    if (!localTriangles || !localEdges) continue;

    const triLen = localTriangles.length;
    const edgeLen = localEdges.length;

    // バッファ容量オーバーフロー防止ガード
    if (
      fillOffset + (triLen / 2) * FLOATS_PER_VERTEX >= MAX_FILL_FLOATS ||
      lineOffset + (edgeLen / 2) * FLOATS_PER_VERTEX >= MAX_LINE_FLOATS
    ) {
      break;
    }

    const rgba = graphicsData.cachedRgba || [1.0, 1.0, 1.0, 1.0];
    const r = rgba[0];
    const g = rgba[1];
    const b = rgba[2];
    const a = rgba[3];

    const angle = body.angle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // ピースの隙間 (目地) スケーリング: 0%で完全密着、%が上がるほど適度な隙間を確保
    const gapPercent = simulationState.pieceGapPercent ?? 12;
    const gapScale = Math.max(0.3, 1.0 - (gapPercent / 100) * 0.45);

    // 1. 三角形ファン頂点をワールド座標に変換してパック
    for (let t = 0; t < triLen; t += 2) {
      const lx = localTriangles[t] * gapScale;
      const ly = localTriangles[t + 1] * gapScale;

      fillVertexArray[fillOffset++] = posX + lx * cosA - ly * sinA;
      fillVertexArray[fillOffset++] = posY + lx * sinA + ly * cosA;
      fillVertexArray[fillOffset++] = r;
      fillVertexArray[fillOffset++] = g;
      fillVertexArray[fillOffset++] = b;
      fillVertexArray[fillOffset++] = a;
    }

    // 2. 輪郭線頂点をワールド座標に変換してパック
    for (let e = 0; e < edgeLen; e += 2) {
      const lx = localEdges[e] * gapScale;
      const ly = localEdges[e + 1] * gapScale;

      lineVertexArray[lineOffset++] = posX + lx * cosA - ly * sinA;
      lineVertexArray[lineOffset++] = posY + lx * sinA + ly * cosA;
      lineVertexArray[lineOffset++] = lineR;
      lineVertexArray[lineOffset++] = lineG;
      lineVertexArray[lineOffset++] = lineB;
      lineVertexArray[lineOffset++] = lineA;
    }
  }

  const fillVertexCount = fillOffset / FLOATS_PER_VERTEX;
  const lineVertexCount = lineOffset / FLOATS_PER_VERTEX;

  if (fillVertexCount === 0) return true;

  // WebGL描画ステートを設定
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.useProgram(glProgram);
  gl.uniform2f(uResolutionLocation, screenWidth, screenHeight);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);

  // 1. 塗りつぶし描画 (たった1回のドローコール！)
  gl.bindVertexArray(fillVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, fillVbo);
  gl.bufferSubData(
    gl.ARRAY_BUFFER,
    0,
    fillVertexArray.subarray(0, fillOffset),
  );
  gl.drawArrays(gl.TRIANGLES, 0, fillVertexCount);

  // 2. 輪郭線描画 (たった1回のドローコール！)
  if (lineVertexCount > 0) {
    gl.bindVertexArray(lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      lineVertexArray.subarray(0, lineOffset),
    );
    gl.drawArrays(gl.LINES, 0, lineVertexCount);
  }

  // p5.js の WebGL ステートを保護するためクリーンアップ
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.useProgram(null);

  lastGpuRenderDurationMs = performance.now() - startTime;
  return true;
}
