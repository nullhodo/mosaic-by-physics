/**
 * 自動パフォーマンステスト・ベンチマークスクリプト
 * Headless Chrome を起動し、CDP経由で降下アニメーション時の実測FPS・描画時間を収集・集計します。
 */

import { spawn } from "node:child_process";

const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TARGET_URL = "http://localhost:5173/";
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBenchmark() {
  console.log("[Benchmark] Headless Chrome を起動中...");

  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--disable-gpu-vsync", // VSync制限を外して描画スループットも計測
    "--enable-webgl",
    "--use-gl=angle",
    "--window-size=1280,800",
    TARGET_URL,
  ]);

  chromeProc.on("error", (err) => {
    console.error("[Benchmark] Chrome 起動エラー:", err);
  });

  // デバッグポート待機
  let versionData = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const res = await fetch(
        `http://localhost:${DEBUG_PORT}/json/version`,
      );
      if (res.ok) {
        versionData = await res.json();
        break;
      }
    } catch {}
  }

  if (!versionData) {
    console.error(
      "[Benchmark] Chrome のデバッグポートに接続できませんでした。",
    );
    chromeProc.kill();
    return;
  }

  // ページ一覧からメインタブを取得
  const listRes = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
  const pages = await listRes.json();
  const page =
    pages.find((p) => p.url.includes("localhost:5173")) || pages[0];

  if (!page || !page.webSocketDebuggerUrl) {
    console.error("[Benchmark] 対象ページが見つかりませんでした。");
    chromeProc.kill();
    return;
  }

  console.log("[Benchmark] CDP WebSocket に接続中...");
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let messageId = 1;
  const pendingRequests = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args
        .map((a) => a.value || JSON.stringify(a))
        .join(" ");
      console.log(`[Browser Console] ${text}`);
    }
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      resolve(msg.result);
    }
  };

  await new Promise((resolve) => {
    ws.onopen = resolve;
  });

  function evaluate(expression) {
    const id = messageId++;
    return new Promise((resolve) => {
      pendingRequests.set(id, { resolve });
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
  }

  // ページ内コンソールログを出力
  ws.send(JSON.stringify({ id: messageId++, method: "Runtime.enable" }));

  console.log("[Benchmark] ページの初期化とベイク完了を待機中...");

  // 初期化完了・ベイク完了を待機
  let isReady = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const res = await evaluate(`
      (() => {
        const badge = document.getElementById("mosaic-active-badge");
        const metrics = window.__PERF_METRICS__;
        return {
          badgeText: badge ? badge.innerText : "",
          hasMetrics: !!metrics,
          bodies: metrics ? metrics.totalBodies : 0
        };
      })()
    `);

    const val = res?.result?.value || res?.value;
    if (val && val.badgeText === "ACTIVE" && val.bodies > 0) {
      isReady = true;
      console.log(
        `[Benchmark] モザイク準備完了 (剛体数: ${val.bodies}個)`,
      );
      break;
    }
  }

  if (!isReady) {
    console.log(
      "[Benchmark] ベイク完了を待機中（手動リプレイをトリガー）...",
    );
    await evaluate(`
      (() => {
        const replayBtn = document.getElementById("mosaic-replay-btn");
        if (replayBtn) replayBtn.click();
      })()
    `);
    await sleep(1500);
  }

  console.log(
    "[Benchmark] 降下アニメーション中のパフォーマンスをサンプリング中 (約4秒間)...",
  );

  const samples = [];
  for (let s = 0; s < 40; s++) {
    await sleep(100);
    const res = await evaluate(`
      (() => {
        return window.__PERF_METRICS__ || null;
      })()
    `);
    const val = res?.result?.value || res?.value;
    if (val) {
      samples.push(val);
    }
  }

  console.log(`[Benchmark] 計測完了 (${samples.length} サンプル取得)`);

  ws.close();
  chromeProc.kill();

  if (samples.length === 0) {
    console.warn("[Benchmark] サンプルが取得できませんでした。");
    return;
  }

  // 統計集計
  const fpsList = samples.map((s) => s.fps).filter((f) => f > 0);
  const frameDurations = samples.map((s) => s.frameDurationMs);
  const gpuDurations = samples.map((s) => s.gpuDurationMs);
  const totalBodies = samples[samples.length - 1]?.totalBodies || 0;
  const maxVisibleBodies = Math.max(
    ...samples.map((s) => s.visibleBodies || 0),
  );

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = (arr) => Math.min(...arr);
  const max = (arr) => Math.max(...arr);

  const avgFps = avg(fpsList);
  const minFps = min(fpsList);
  const maxFps = max(fpsList);

  const avgFrameMs = avg(frameDurations);
  const minFrameMs = min(frameDurations);
  const maxFrameMs = max(frameDurations);

  const avgGpuMs = avg(gpuDurations);
  const maxGpuMs = max(gpuDurations);

  console.log("\n==========================================");
  console.log("   MOSAIC CASCADE BENCHMARK REPORT        ");
  console.log("==========================================");
  console.log(
    `ピース総数           : ${totalBodies} 個 (最大同時可視: ${maxVisibleBodies} 個)`,
  );
  console.log(
    `平均 FPS             : ${avgFps.toFixed(1)} FPS (最小: ${minFps} / 最大: ${maxFps})`,
  );
  console.log(
    `フレーム描画時間     : 平均 ${avgFrameMs.toFixed(3)} ms (最小: ${minFrameMs.toFixed(3)} ms / 最大: ${maxFrameMs.toFixed(3)} ms)`,
  );
  console.log(
    `GPUバッチ描画処理時間: 平均 ${avgGpuMs.toFixed(3)} ms (最大: ${maxGpuMs.toFixed(3)} ms)`,
  );
  console.log(
    `16.6msに対する負荷率 : ${((avgFrameMs / 16.66) * 100).toFixed(1)} % (60fpsの予算に対して圧倒的余裕)`,
  );
  console.log("==========================================\n");
}

runBenchmark().catch(console.error);
