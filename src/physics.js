import { colorPalettes } from "./constants/palettes.js";
import { cachePieceBatchGeometry } from "./gpuRenderer.js";
import { currentProcessedImage } from "./imageProcessor.js";
import { debugLogMessage, simulationState } from "./state.js";

export let physicsEngineInstance = null;
export let physicsWorldInstance = null;
export let groundPhysicsBody = null;
export let leftWallPhysicsBody = null;
export let rightWallPhysicsBody = null;
export const activeGeometricBodies = [];

// モザイク事前シミュレーション（ベイク）済みデータ
export let bakedMosaicDescriptors = [];
let mosaicPlaybackIndex = 0;
let isMosaicActive = false;

/**
 * Matter.jsエンジンを初期化し、境界コライダーを設定
 */
export function initializePhysicsWorld() {
  const Engine = Matter.Engine;
  const World = Matter.World;
  const Bodies = Matter.Bodies;

  if (physicsEngineInstance) {
    Matter.World.clear(physicsWorldInstance, false);
    Matter.Engine.clear(physicsEngineInstance);
  }

  physicsEngineInstance = Engine.create({
    positionIterations: 4,
    velocityIterations: 4,
    constraintIterations: 1,
    enableSleeping: true,
  });
  physicsWorldInstance = physicsEngineInstance.world;
  physicsWorldInstance.gravity.y = simulationState.gravityForce;

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const wallThickness = 800;
  const floorTopY = screenHeight - simulationState.floorOffsetDistance;

  groundPhysicsBody = Bodies.rectangle(
    screenWidth / 2,
    floorTopY + wallThickness / 2,
    screenWidth * 4,
    wallThickness,
    {
      isStatic: true,
      restitution: simulationState.restitutionCoeff,
      friction: 0.8,
      slop: 0.05,
    },
  );

  leftWallPhysicsBody = Bodies.rectangle(
    -wallThickness / 2,
    screenHeight / 2,
    wallThickness,
    screenHeight * 4,
    {
      isStatic: true,
      restitution: simulationState.restitutionCoeff,
      friction: 0.2,
    },
  );

  rightWallPhysicsBody = Bodies.rectangle(
    screenWidth + wallThickness / 2,
    screenHeight / 2,
    wallThickness,
    screenHeight * 4,
    {
      isStatic: true,
      restitution: simulationState.restitutionCoeff,
      friction: 0.2,
    },
  );

  World.add(physicsWorldInstance, [
    groundPhysicsBody,
    leftWallPhysicsBody,
    rightWallPhysicsBody,
  ]);

  frameBottomBody = null;
  frameLeftBody = null;
  frameRightBody = null;
  updateMosaicFramePhysics();

  Matter.Events.on(
    physicsEngineInstance,
    "collisionStart",
    (collisionEvent) => {
      if (simulationState.isDebugMode) {
        console.log(
          `[Collision Event] Contacts active: ${collisionEvent.pairs.length}`,
        );
      }
    },
  );

  debugLogMessage("Physics Initialized", {
    width: screenWidth,
    height: screenHeight,
    floorTopY,
  });
}

/**
 * ウィンドウ境界に合わせて静的壁と床の位置を更新
 */
export function updatePhysicsFloorPosition() {
  if (!physicsWorldInstance || !groundPhysicsBody) return;
  const wallThickness = 800;
  const floorTopY =
    window.innerHeight - simulationState.floorOffsetDistance;
  Matter.Body.setPosition(groundPhysicsBody, {
    x: window.innerWidth / 2,
    y: floorTopY + wallThickness / 2,
  });
  Matter.Body.set(
    groundPhysicsBody,
    "restitution",
    simulationState.restitutionCoeff,
  );

  if (rightWallPhysicsBody) {
    Matter.Body.setPosition(rightWallPhysicsBody, {
      x: window.innerWidth + wallThickness / 2,
      y: window.innerHeight / 2,
    });
  }
  if (leftWallPhysicsBody) {
    Matter.Body.setPosition(leftWallPhysicsBody, {
      x: -wallThickness / 2,
      y: window.innerHeight / 2,
    });
  }
  updateMosaicFramePhysics();
}

/**
 * 凸多角形の頂点群を生成 (元のロジック完全復元)
 */
export function generateOrganicPolygonVertices(baseRadius, vertexCount) {
  const generatedVertices = [];
  const angleStep = (Math.PI * 2) / vertexCount;
  const minimumRadiusRatio = 0.65;

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    const currentAngle =
      vertexIndex * angleStep + (Math.random() - 0.5) * angleStep * 0.35;
    const radiusFactor =
      minimumRadiusRatio +
      (1.0 - minimumRadiusRatio) *
        (0.5 + 0.5 * Math.sin(vertexIndex * 2.0 + Math.random()));
    const vertexDistance = baseRadius * radiusFactor;

    generatedVertices.push({
      x: Math.cos(currentAngle) * vertexDistance,
      y: Math.sin(currentAngle) * vertexDistance,
    });
  }
  return generatedVertices;
}

export function pickObjectColorFromPalette() {
  const activePalette = colorPalettes[simulationState.activePaletteIndex];
  if (!activePalette || !activePalette.colors) return "#FFFFFF";
  const currentBgHex = simulationState.backgroundColorHex.toLowerCase();

  const availableColors = activePalette.colors.filter((colorObject) => {
    return colorObject.hex.toLowerCase() !== currentBgHex;
  });

  if (availableColors.length > 0) {
    const randomChoice =
      availableColors[Math.floor(Math.random() * availableColors.length)];
    return randomChoice.hex;
  }
  return "#FFFFFF";
}

/**
 * 既存の全図形の色を現在のアクティブパレットから再割り当て
 */
export function reapplyPaletteToExistingBodies() {
  const activePalette = colorPalettes[simulationState.activePaletteIndex];
  if (
    !activePalette ||
    !activePalette.colors ||
    activePalette.colors.length === 0
  )
    return;

  const currentBgHex = simulationState.backgroundColorHex.toLowerCase();
  const availableColors = activePalette.colors.filter((colorObject) => {
    return colorObject.hex.toLowerCase() !== currentBgHex;
  });

  const colorList =
    availableColors.length > 0 ? availableColors : activePalette.colors;

  for (let i = 0; i < activeGeometricBodies.length; i++) {
    const body = activeGeometricBodies[i];
    if (!body.customGraphicsData) continue;
    const chosenColor =
      colorList[Math.floor(Math.random() * colorList.length)].hex;
    body.customGraphicsData.fillColor = chosenColor;
  }
}

/**
 * モザイク用の未投下図形があるかどうか
 */
export function hasRemainingMosaicBodies() {
  return (
    isMosaicActive &&
    bakedMosaicDescriptors.length > 0 &&
    mosaicPlaybackIndex < bakedMosaicDescriptors.length
  );
}

/**
 * 有機的幾何学モザイクボディを生成してワールドに追加
 * (絵に関係のないランダムオブジェクトの生成を完全に遮断)
 */
export function spawnOrganicGeometricBody() {
  if (!physicsWorldInstance) return false;

  // モザイクカスケード中であり、未投下のベイク図形がある場合のみスポーン
  if (
    isMosaicActive &&
    mosaicPlaybackIndex < bakedMosaicDescriptors.length
  ) {
    const desc = bakedMosaicDescriptors[mosaicPlaybackIndex];
    const body = createOrganicBodyFromDescriptor(desc);
    Matter.World.add(physicsWorldInstance, body);
    activeGeometricBodies.push(body);
    mosaicPlaybackIndex++;
    updateBodiesCountUI();
    return true;
  }

  // ベイク済み図形がすべて落ち切った、あるいは未ベイクの場合は何も生成しない
  return false;
}

/**
 * 軌跡データのキーフレーム間隔 (3ステップに1回記録してメモリを1/3に圧縮し、再生時にLerp補間)
 */
export const KEYFRAME_INTERVAL = 3;

/**
 * (A) Matter.js の物理剛体を完全撤廃し、超軽量なプレーンオブジェクトを生成
 * (再生時は物理演算を行わないため、重い Matter.Body インスタンスが一切不要)
 */
function createOrganicBodyFromDescriptor(desc) {
  return {
    id: desc.id,
    position: { x: desc.spawnX, y: desc.spawnY },
    angle: 0,
    isVisible: false,
    customGraphicsData: {
      fillColor: desc.colorHex,
      radius: desc.radius,
      localVertices: desc.convexPoints,
      depth3D: desc.radius * 0.75,
      rotationZ3D: Math.random() * Math.PI,
      rotationSpeed3D: (Math.random() - 0.5) * 0.03,
      curvature: desc.curvatureRatio,
    },
  };
}

let consecutiveFullFrames = 0;

/**
 * 画面が図形で満杯かを判定 (元の関数完全復元)
 */
export function checkIsContainerFull() {
  if (activeGeometricBodies.length < 35) {
    consecutiveFullFrames = 0;
    return false;
  }

  const topThresholdY = Math.max(50, window.innerHeight * 0.08);
  let topRestingCount = 0;
  let minX = window.innerWidth;
  let maxX = 0;

  const sectionLeft = window.innerWidth * 0.33;
  const sectionRight = window.innerWidth * 0.67;
  let hasLeft = false;
  let hasCenter = false;
  let hasRight = false;

  for (let i = 0; i < activeGeometricBodies.length; i++) {
    const body = activeGeometricBodies[i];
    if (
      body.position.y > 20 &&
      body.bounds.min.y <= topThresholdY &&
      (body.isSleeping || body.speed < 0.5)
    ) {
      topRestingCount++;
      if (body.position.x < minX) minX = body.position.x;
      if (body.position.x > maxX) maxX = body.position.x;

      if (body.position.x < sectionLeft) hasLeft = true;
      else if (body.position.x > sectionRight) hasRight = true;
      else hasCenter = true;
    }
  }

  const isSufficientlyFull =
    (topRestingCount >= 4 &&
      maxX - minX > window.innerWidth * 0.55 &&
      (hasLeft || hasRight)) ||
    (hasLeft && hasCenter && hasRight && topRestingCount >= 3) ||
    (activeGeometricBodies.length >= 220 && topRestingCount >= 2);

  if (isSufficientlyFull) {
    consecutiveFullFrames++;
    if (consecutiveFullFrames >= 30) {
      return true;
    }
  } else {
    consecutiveFullFrames = 0;
  }

  return false;
}

export function clearAllGeometricBodies() {
  consecutiveFullFrames = 0;
  if (!physicsWorldInstance) return;
  if (physicsWorldInstance) {
    for (const body of activeGeometricBodies) {
      if (body && typeof body.id === "number" && body.vertices) {
        Matter.World.remove(physicsWorldInstance, body);
      }
    }
  }
  activeGeometricBodies.length = 0;
  updateBodiesCountUI();
  const badgeElem = document.getElementById("full-status-badge");
  if (badgeElem) badgeElem.classList.add("hidden");
}

function updateBodiesCountUI() {
  const countElem = document.getElementById("bodies-count-display");
  if (countElem) countElem.innerText = activeGeometricBodies.length;
}

/* =========================================================================
   モザイク物理シミュレーション (絵画フレーム枠 ＆ 最終座標カラーマッピング)
   ========================================================================= */

export let mosaicFrameBounds = {
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  width: 0,
  height: 0,
  centerX: 0,
  centerY: 0,
};

export let frameBottomBody = null;
export let frameLeftBody = null;
export let frameRightBody = null;

export function getMosaicTargetBounds() {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  // ツールウィンドウ (380px) の開閉で枠位置がブレないよう、
  // 右側メインキャンバス領域の中央に常に安定固定配置
  const leftEdge = screenWidth > 800 ? 390 : 30;
  const rightEdge = screenWidth - 30;
  const availableWidth = Math.max(280, rightEdge - leftEdge);
  const availableHeight = Math.max(280, screenHeight - 90);

  const ar = currentProcessedImage.aspectRatio || 0.8;
  let width;
  let height;

  // 画面の高さの約72%を目安にアスペクト比通りのフレームサイズを算出
  const targetMaxHeight = Math.min(availableHeight * 0.82, 580);
  const targetMaxWidth = Math.min(availableWidth * 0.82, 700);

  if (targetMaxWidth / targetMaxHeight > ar) {
    height = targetMaxHeight;
    width = height * ar;
  } else {
    width = targetMaxWidth;
    height = width / ar;
  }

  width = Math.max(220, width);
  height = Math.max(220, height);

  const centerX = leftEdge + availableWidth / 2;
  const centerY = screenHeight / 2 + 10;
  const left = centerX - width / 2;
  const right = centerX + width / 2;
  const top = centerY - height / 2;
  const bottom = centerY + height / 2;

  mosaicFrameBounds = {
    left,
    right,
    top,
    bottom,
    width,
    height,
    centerX,
    centerY,
  };
  return mosaicFrameBounds;
}

/**
 * メインの物理ワールドに額縁フレームの物理コライダー（底壁・左右壁）を配置・更新
 * (床コライダーとの重なりを防ぎ、オブジェクトのすり抜けを完全に遮断)
 */
export function updateMosaicFramePhysics() {
  if (!physicsWorldInstance) return;
  const bounds = getMosaicTargetBounds();
  const wallThickness = 60;

  // 以前のフレーム壁を確実にワールドから削除して破棄
  if (frameBottomBody) {
    Matter.World.remove(physicsWorldInstance, frameBottomBody);
    frameBottomBody = null;
  }
  if (frameLeftBody) {
    Matter.World.remove(physicsWorldInstance, frameLeftBody);
    frameLeftBody = null;
  }
  if (frameRightBody) {
    Matter.World.remove(physicsWorldInstance, frameRightBody);
    frameRightBody = null;
  }

  // 底壁: 上面がちょうど額縁の bounds.bottom に一致
  frameBottomBody = Matter.Bodies.rectangle(
    bounds.centerX,
    bounds.bottom + wallThickness / 2,
    bounds.width + wallThickness * 2,
    wallThickness,
    {
      isStatic: true,
      restitution: 0.1,
      friction: 0.9,
      label: "frameBottomWall",
    },
  );

  // 左壁: 右面がちょうど額縁の bounds.left に一致、上空高く伸ばして外への漏れを防止
  frameLeftBody = Matter.Bodies.rectangle(
    bounds.left - wallThickness / 2,
    bounds.centerY - bounds.height * 0.5,
    wallThickness,
    bounds.height * 3,
    {
      isStatic: true,
      restitution: 0.1,
      friction: 0.4,
      label: "frameLeftWall",
    },
  );

  // 右壁: 左面がちょうど額縁の bounds.right に一致
  frameRightBody = Matter.Bodies.rectangle(
    bounds.right + wallThickness / 2,
    bounds.centerY - bounds.height * 0.5,
    wallThickness,
    bounds.height * 3,
    {
      isStatic: true,
      restitution: 0.1,
      friction: 0.4,
      label: "frameRightWall",
    },
  );

  // メインワールドに確実に追加
  Matter.World.add(physicsWorldInstance, [
    frameBottomBody,
    frameLeftBody,
    frameRightBody,
  ]);
}

let activeBakeId = 0;

/**
 * 物理シミュレーションを事前実行し、額縁内に満ちた最終座標を記録してドット絵の色を割り当てる
 */
export async function bakeMosaicPhysics(onProgress = null) {
  const currentBakeId = ++activeBakeId;
  isMosaicActive = true;
  const bounds = getMosaicTargetBounds();
  updateMosaicFramePhysics();

  // ヘッドレス物理ワールドの作成
  const bakeEngine = Matter.Engine.create({
    positionIterations: 4,
    velocityIterations: 4,
    enableSleeping: true,
  });
  const bakeWorld = bakeEngine.world;
  bakeWorld.gravity.y = simulationState.gravityForce;

  const wallThickness = 60;

  // 額縁の物理壁（底壁・左右壁）- メインワールドと全く同一の寸法・位置
  const bBottom = Matter.Bodies.rectangle(
    bounds.centerX,
    bounds.bottom + wallThickness / 2,
    bounds.width + wallThickness * 2,
    wallThickness,
    {
      isStatic: true,
      restitution: 0.1,
      friction: 0.9,
    },
  );
  const bLeft = Matter.Bodies.rectangle(
    bounds.left - wallThickness / 2,
    bounds.centerY - bounds.height * 0.5,
    wallThickness,
    bounds.height * 3,
    {
      isStatic: true,
      restitution: 0.1,
      friction: 0.4,
    },
  );
  const bRight = Matter.Bodies.rectangle(
    bounds.right + wallThickness / 2,
    bounds.centerY - bounds.height * 0.5,
    wallThickness,
    bounds.height * 3,
    {
      isStatic: true,
      restitution: 0.1,
      friction: 0.4,
    },
  );

  Matter.World.add(bakeWorld, [bBottom, bLeft, bRight]);

  const descriptors = [];
  const baseRadius = Math.max(5, simulationState.shapeBaseRadius || 14);
  const variationRatio =
    (simulationState.shapeSizeVariationPercent || 25) / 100;
  const vertexCount = Math.max(4, simulationState.shapeVertexCount || 5);
  const curvatureRatio =
    (simulationState.shapeCurvaturePercent || 80) / 100;

  // 額縁の面積と基本サイズから、十分なプール数を確保 (足りなくなるのを防ぐため、余裕を持った1.70倍プール)
  const area = bounds.width * bounds.height;
  const avgBodyArea = Math.PI * baseRadius * baseRadius;
  const poolCount = Math.max(
    30,
    Math.min(1300, Math.round((area * 1.7) / avgBodyArea)),
  );

  // 額縁上端の到達センシング用パラメータ
  const topThresholdY = bounds.top + baseRadius * 1.1;
  const requiredTopRestingCount = Math.max(
    3,
    Math.floor(bounds.width / (baseRadius * 2.3)),
  );

  for (let i = 0; i < poolCount; i++) {
    const randomFactor =
      1.0 + (Math.random() * 2 - 1) * variationRatio * 0.35;
    const rad = Math.max(4, baseRadius * randomFactor);

    // 額縁の上部開口部からスムーズに投入
    const spawnMargin = rad * 0.9;
    const spawnX =
      bounds.left +
      spawnMargin +
      Math.random() * Math.max(10, bounds.width - spawnMargin * 2);
    const spawnY = bounds.top - 30 - Math.random() * 70;

    const rawPoints = generateOrganicPolygonVertices(rad, vertexCount);
    const convexPoints = Matter.Vertices.hull(rawPoints);
    Matter.Vertices.clockwiseSort(convexPoints);

    descriptors.push({
      id: i,
      spawnX,
      spawnY,
      spawnStep: 0,
      radius: rad,
      vertexCount,
      curvatureRatio,
      convexPoints,
      colorHex: "#FFFFFF",
      finalX: 0,
      finalY: 0,
      finalAngle: 0,
      trajectory: [],
    });
  }

  const bakeBodies = [];
  let spawnedCount = 0;
  let isTopFilled = false;
  let spawnFinishedStep = -1;

  // 円形コライダーにより超高速化されたため、一括投入バッチを最適化
  const spawnBatch = poolCount > 400 ? 6 : poolCount > 200 ? 4 : 3;
  const spawnInterval = 2;
  const subDelta = 1000 / 60;
  const estimatedSpawnSteps =
    Math.ceil(poolCount / spawnBatch) * spawnInterval;
  const estimatedTotalSteps = estimatedSpawnSteps + 120;
  const maxSteps = Math.min(1200, estimatedTotalSteps + 200);
  let totalStepsRecorded = 0;

  for (let step = 0; step < maxSteps; step++) {
    // 新しい計算が開始された場合は即座に中断
    if (currentBakeId !== activeBakeId) {
      Matter.World.clear(bakeWorld, false);
      Matter.Engine.clear(bakeEngine);
      return;
    }

    // 最低必要個数 (額縁面積の90%相当) に達するまでは上端判定を行わない (落下中の誤判定を100%防止)
    const minSpawnRequired = Math.max(
      25,
      Math.round((area * 0.9) / avgBodyArea),
    );

    // 上端到達判定: 額縁上端付近 (bounds.top 〜 topThresholdY) に十分な数の落ち着いたピースが到達したらスポーン終了
    if (!isTopFilled && spawnedCount >= minSpawnRequired) {
      let topCount = 0;
      for (let b = 0; b < bakeBodies.length; b++) {
        const body = bakeBodies[b];
        const desc = descriptors[body.descIndex];
        // スポーンから十分時間 (35ステップ以上) が経過し、額縁天面スロット内に静止しているピースのみ対象
        if (
          step - desc.spawnStep >= 35 &&
          body.position.y >= bounds.top - 5 &&
          body.position.y <= topThresholdY &&
          body.position.x >= bounds.left &&
          body.position.x <= bounds.right &&
          body.speed < 1.0
        ) {
          topCount++;
        }
      }
      if (
        topCount >= requiredTopRestingCount ||
        spawnedCount >= poolCount
      ) {
        isTopFilled = true;
        spawnFinishedStep = step;
      }
    }

    // スポーン処理 (上端が満たされるまで継続投入)
    if (
      !isTopFilled &&
      step % spawnInterval === 0 &&
      spawnedCount < poolCount
    ) {
      const toSpawn = Math.min(spawnBatch, poolCount - spawnedCount);
      const isSineSwing = simulationState.isSineWaveSpawnActive !== false;
      const swingCenterX = bounds.left + bounds.width * 0.5;
      const swingAmplitude = bounds.width * 0.5 * 0.75;
      const swingPhase = step * 0.045;
      const swingVelocityX = Math.cos(swingPhase) * 1.8;

      for (let s = 0; s < toSpawn; s++) {
        const desc = descriptors[spawnedCount];
        desc.spawnStep = step;
        desc.trajectory = [];

        // 正弦波スイング投入が有効な場合、左右に滑らかに往復する供給位置から投入
        if (isSineSwing) {
          const localJitter = (Math.random() * 2 - 1) * (baseRadius * 1.5);
          const targetX =
            swingCenterX +
            Math.sin(swingPhase) * swingAmplitude +
            localJitter;
          const margin = desc.radius * 1.0;
          desc.spawnX = Math.max(
            bounds.left + margin,
            Math.min(bounds.right - margin, targetX),
          );
          desc.spawnY = bounds.top - 20 - s * 6 - Math.random() * 10;
        }

        // ヘッドレスベイクは超高速な円形コライダーで実行 (衝突判定コストを 1/100 に激減)
        const body = Matter.Bodies.circle(
          desc.spawnX,
          desc.spawnY,
          desc.radius * 0.95,
          {
            restitution: 0.1,
            friction: 0.8,
            frictionAir: 0.025,
            density: 0.003,
            sleepThreshold: 30,
          },
        );

        if (isSineSwing) {
          Matter.Body.setVelocity(body, {
            x: swingVelocityX,
            y: 0.8,
          });
        }

        body.descIndex = spawnedCount;
        Matter.World.add(bakeWorld, body);
        bakeBodies.push(body);
        spawnedCount++;
      }
    }

    Matter.Engine.update(bakeEngine, subDelta);

    // (B) キーフレーム間引きサンプリング (KEYFRAME_INTERVAL ステップごとに記録してメモリ1/3圧縮)
    if (step % KEYFRAME_INTERVAL === 0) {
      for (let b = 0; b < bakeBodies.length; b++) {
        const body = bakeBodies[b];
        const desc = descriptors[body.descIndex];
        desc.trajectory.push({
          x: Math.round(body.position.x * 10) / 10,
          y: Math.round(body.position.y * 10) / 10,
          angle: Math.round(body.angle * 100) / 100,
        });
      }
    }

    totalStepsRecorded = step;

    // 定期的な進捗コールバック (4ステップごとに更新して小数点以下第3位の変化を滑らかに表示)
    if (step % 4 === 0) {
      if (onProgress) {
        const rawPct = Math.min(94.0, (step / estimatedTotalSteps) * 94.0);
        const stabPct = Math.min(
          95.0,
          (step / estimatedTotalSteps) * 100.0,
        );
        const phaseText = !isTopFilled
          ? `額縁を充填中... (${spawnedCount} 個投入)`
          : `物理安定化中... (${stabPct.toFixed(3)}%)`;
        onProgress({
          percent: rawPct,
          phaseText,
          spawnedCount,
          totalCount: spawnedCount,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // スポーン終了後、十分な安定化ステップ (最低60ステップ) を経て、動きが収束したら完了
    const minWaitStep =
      spawnFinishedStep > 0
        ? spawnFinishedStep + 60
        : estimatedSpawnSteps + 60;
    if (isTopFilled && step > minWaitStep) {
      let moving = 0;
      for (let b = 0; b < bakeBodies.length; b++) {
        if (!bakeBodies[b].isSleeping && bakeBodies[b].speed > 0.2) {
          moving++;
        }
      }
      if (moving < Math.max(2, Math.floor(spawnedCount * 0.02))) break;
    }
  }

  // キャンセルチェック
  if (currentBakeId !== activeBakeId) {
    Matter.World.clear(bakeWorld, false);
    Matter.Engine.clear(bakeEngine);
    return;
  }

  // 最終静止判定後、額縁の上端枠線より上にあふれ出た余剰ピースを精密トリミング
  if (onProgress) {
    onProgress({
      percent: 96.0,
      phaseText: "額縁枠外の余剰ピースをトリミング＆カラー抽出中...",
      spawnedCount,
      totalCount: spawnedCount,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 10));

  const validDescriptors = [];
  const topLimit = bounds.top - baseRadius * 0.15;
  const bottomLimit = bounds.bottom + baseRadius * 0.5;
  const leftLimit = bounds.left - baseRadius * 0.5;
  const rightLimit = bounds.right + baseRadius * 0.5;

  for (let b = 0; b < bakeBodies.length; b++) {
    const body = bakeBodies[b];
    const desc = descriptors[body.descIndex];

    // 額縁の上端より上にあふれたピース、または左右・底面枠外のピースを除外
    if (
      body.position.y < topLimit ||
      body.position.y > bottomLimit ||
      body.position.x < leftLimit ||
      body.position.x > rightLimit
    ) {
      continue;
    }

    desc.finalX = body.position.x;
    desc.finalY = body.position.y;
    desc.finalAngle = body.angle;

    const sampled = currentProcessedImage.sampleColorAtWorld(
      desc.finalX,
      desc.finalY,
      bounds,
    );
    desc.colorHex = sampled.hex;
    validDescriptors.push(desc);
  }

  // ID を 0 から順に再付番
  for (let i = 0; i < validDescriptors.length; i++) {
    validDescriptors[i].id = i;
  }

  simulationState.targetObjectCount = validDescriptors.length;

  Matter.World.clear(bakeWorld, false);
  Matter.Engine.clear(bakeEngine);

  bakedMosaicDescriptors = validDescriptors;
  totalBakeSteps = totalStepsRecorded;
  setupMosaicDisplayBodies();
  resetPlaybackToStart();

  if (onProgress) {
    onProgress({
      percent: 100,
      phaseText: "完了！モザイク降下を開始します",
      spawnedCount: validDescriptors.length,
      totalCount: validDescriptors.length,
    });
  }
}

export let currentPlaybackStep = 0;
export let isMosaicPlaybackComplete = false;
export let totalBakeSteps = 0;

/**
 * ベイク完了時に全描画用ボディを一度だけ準備
 */
export function setupMosaicDisplayBodies() {
  clearAllGeometricBodies();
  const curvatureRatio = simulationState.shapeCurvaturePercent / 100;
  for (let i = 0; i < bakedMosaicDescriptors.length; i++) {
    const desc = bakedMosaicDescriptors[i];
    const body = createOrganicBodyFromDescriptor(desc);
    body.isVisible = false;
    // GPUレンダラー用の幾何データ（三角形・エッジ）と色を事前キャッシュ
    cachePieceBatchGeometry(body, curvatureRatio);
    // (A) Matter.World には登録しない！(物理エンジンを完全停止しメモリ＆CPUゼロ化)
    activeGeometricBodies.push(body);
  }
  updateBodiesCountUI();
}

/**
 * 決定論的軌跡再生: キーフレーム間を線形補間 (Lerp) して超滑らかに再生
 * (メモリ1/3圧縮 + CPU負荷ゼロの完全トレース再生)
 */
export function advanceMosaicPlayback(speed = 1.0) {
  if (isMosaicPlaybackComplete || bakedMosaicDescriptors.length === 0)
    return;

  currentPlaybackStep += speed;

  for (let i = 0; i < bakedMosaicDescriptors.length; i++) {
    const desc = bakedMosaicDescriptors[i];
    const body = activeGeometricBodies[i];
    if (!body) continue;

    if (currentPlaybackStep < desc.spawnStep) {
      body.isVisible = false;
    } else {
      body.isVisible = true;
      const elapsed = currentPlaybackStep - desc.spawnStep;
      const keyframePos = elapsed / KEYFRAME_INTERVAL;
      const idx0 = Math.floor(keyframePos);
      const alpha = keyframePos - idx0;

      if (idx0 < desc.trajectory.length) {
        const k0 = desc.trajectory[idx0];
        const k1 =
          idx0 + 1 < desc.trajectory.length
            ? desc.trajectory[idx0 + 1]
            : {
                x: desc.finalX,
                y: desc.finalY,
                angle: desc.finalAngle || 0,
              };

        // (B) 線形補間（Lerp）によるシルキースムース再生
        body.position.x = k0.x + (k1.x - k0.x) * alpha;
        body.position.y = k0.y + (k1.y - k0.y) * alpha;
        body.angle = k0.angle + (k1.angle - k0.angle) * alpha;
      } else {
        body.position.x = desc.finalX;
        body.position.y = desc.finalY;
        body.angle = desc.finalAngle || 0;
      }
    }
  }

  if (currentPlaybackStep >= totalBakeSteps + 40) {
    isMosaicPlaybackComplete = true;
  }
}

export function resetPlaybackToStart() {
  currentPlaybackStep = 0;
  isMosaicPlaybackComplete = false;
  isMosaicActive = true;
  for (let i = 0; i < activeGeometricBodies.length; i++) {
    activeGeometricBodies[i].isVisible = false;
  }
}

export function skipToCompletion() {
  currentPlaybackStep = Number.POSITIVE_INFINITY;
  isMosaicPlaybackComplete = true;
  for (let i = 0; i < bakedMosaicDescriptors.length; i++) {
    const desc = bakedMosaicDescriptors[i];
    const body = activeGeometricBodies[i];
    if (body) {
      body.isVisible = true;
      body.position.x = desc.finalX;
      body.position.y = desc.finalY;
      body.angle = desc.finalAngle || 0;
    }
  }
}
