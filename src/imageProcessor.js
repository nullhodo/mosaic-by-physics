/**
 * Mosaic by Physics - Image Processor & Color Quantization Engine
 * 画像の読み込み、ドット絵化（リサンプリング）、原色化・減色アルゴリズム
 */

// プリセット・サンプル一覧の定義（著作権配慮：パブリックドメイン & CC0）
export const SAMPLE_IMAGES = [
  {
    id: "pearl_earring",
    title: "真珠の耳飾りの少女",
    artist: "ヨハネス・フェルメール (1665)",
    category: "西洋名画 (PD)",
    url: "./samples/pearl_earring.jpg",
  },
  {
    id: "starry_night",
    title: "星月夜",
    artist: "フィンセント・ファン・ゴッホ (1889)",
    category: "ポスト印象派 (PD)",
    url: "./samples/starry_night.jpg",
  },
  {
    id: "great_wave",
    title: "神奈川沖浪裏",
    artist: "葛飾北斎 (1831)",
    category: "浮世絵 (PD)",
    url: "./samples/great_wave.jpg",
  },
  {
    id: "mona_lisa",
    title: "モナ・リザ",
    artist: "レオナルド・ダ・ヴィンチ (1503)",
    category: "ルネサンス名画 (PD)",
    url: "./samples/mona_lisa.jpg",
  },
  {
    id: "the_kiss",
    title: "接吻",
    artist: "グスタフ・クリムト (1908)",
    category: "象徴主義 (PD)",
    url: "./samples/the_kiss.jpg",
  },
  {
    id: "red_fuji",
    title: "凱風快晴 (赤富士)",
    artist: "葛飾北斎 (1831)",
    category: "浮世絵 (PD)",
    url: "./samples/red_fuji.jpg",
  },
  {
    id: "p5_logo",
    title: "p5.js ロゴ",
    artist: "Processing Foundation (CC BY-NC-SA 4.0)",
    category: "ロゴ・ブランド",
    url: "./samples/p5_logo.svg",
  },
];

// 原色・ビビッド系固定パレット（鮮明な原色と補色）
export const PRIMARY_VIVID_PALETTE = [
  { r: 230, g: 0, b: 18, hex: "#E60012" }, // 鮮烈な赤
  { r: 0, g: 91, b: 172, hex: "#005BAC" }, // コバルトブルー
  { r: 255, g: 217, b: 0, hex: "#FFD900" }, // 鮮やかな黄
  { r: 0, g: 153, b: 68, hex: "#009944" }, // エメラルドグリーン
  { r: 0, g: 160, b: 233, hex: "#00A0E9" }, // シアン
  { r: 228, g: 0, b: 127, hex: "#E4007F" }, // マゼンタ
  { r: 243, g: 152, b: 0, hex: "#F39800" }, // オレンジ
  { r: 146, g: 7, b: 131, hex: "#920783" }, // パープル
  { r: 15, g: 23, b: 42, hex: "#0F172A" }, // ディープブラック
  { r: 250, g: 250, b: 250, hex: "#FAFAFA" }, // ピュアホワイト
  { r: 143, g: 89, b: 56, hex: "#8F5938" }, // ウォームブラウン
  { r: 140, g: 150, b: 160, hex: "#8C96A0" }, // スレートグレー
];

// レトロ・パレット集
export const RETRO_PALETTES = {
  gameboy: [
    { r: 15, g: 56, b: 15, hex: "#0F380F" },
    { r: 48, g: 98, b: 48, hex: "#306230" },
    { r: 139, g: 172, b: 15, hex: "#8BAC0F" },
    { r: 155, g: 188, b: 15, hex: "#9BBC0F" },
  ],
  cyberpunk: [
    { r: 13, g: 2, b: 33, hex: "#0D0221" },
    { r: 38, g: 20, b: 71, hex: "#261447" },
    { r: 255, g: 56, b: 100, hex: "#FF3864" },
    { r: 46, g: 238, b: 225, hex: "#2EEEE1" },
    { r: 254, g: 231, b: 21, hex: "#FEE715" },
    { r: 255, g: 255, b: 255, hex: "#FFFFFF" },
  ],
  famicom: [
    { r: 0, g: 0, b: 0, hex: "#000000" },
    { r: 252, g: 252, b: 252, hex: "#FCFCFC" },
    { r: 248, g: 56, b: 0, hex: "#F83800" },
    { r: 0, g: 120, b: 248, hex: "#0078F8" },
    { r: 0, g: 168, b: 0, hex: "#00A800" },
    { r: 252, g: 160, b: 68, hex: "#FCA044" },
    { r: 248, g: 184, b: 0, hex: "#F8B800" },
    { r: 104, g: 68, b: 252, hex: "#6844FC" },
  ],
};

/**
 * 2つのRGB間の知覚的距離（重み付けユークリッド距離）
 */
function calculateColorDistance(r1, g1, b1, r2, g2, b2) {
  // 人間の目の感度（G > R > B）に合わせた重み付け
  const deltaR = r1 - r2;
  const deltaG = g1 - g2;
  const deltaB = b1 - b2;
  const meanR = (r1 + r2) / 2;
  return Math.sqrt(
    (2 + meanR / 256) * deltaR * deltaR +
      4 * deltaG * deltaG +
      (2 + (255 - meanR) / 256) * deltaB * deltaB,
  );
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 画像からK-Meansクラスタリングで適応パレットを高速抽出 (超軽量化)
 */
export function extractAdaptivePalette(pixelDataList, clusterCount = 8) {
  if (pixelDataList.length === 0) return RETRO_PALETTES.gameboy;
  const k = Math.min(clusterCount, pixelDataList.length);

  // 計算量削減のため最大500ピクセルにダウンサンプリング
  const sampleStep = Math.max(1, Math.floor(pixelDataList.length / 500));
  const samples = [];
  for (let i = 0; i < pixelDataList.length; i += sampleStep) {
    samples.push(pixelDataList[i]);
  }

  // 初期重心
  const centroids = [];
  const stride = Math.max(1, Math.floor(samples.length / k));
  for (let i = 0; i < k; i++) {
    centroids.push({ ...samples[(i * stride) % samples.length] });
  }

  // わずか3反復で高速収束
  for (let iter = 0; iter < 3; iter++) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      let bestIndex = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c++) {
        const d = calculateColorDistance(
          p.r,
          p.g,
          p.b,
          centroids[c].r,
          centroids[c].g,
          centroids[c].b,
        );
        if (d < bestDist) {
          bestDist = d;
          bestIndex = c;
        }
      }
      sums[bestIndex].r += p.r;
      sums[bestIndex].g += p.g;
      sums[bestIndex].b += p.b;
      sums[bestIndex].count++;
    }

    for (let c = 0; c < centroids.length; c++) {
      if (sums[c].count > 0) {
        centroids[c].r = Math.round(sums[c].r / sums[c].count);
        centroids[c].g = Math.round(sums[c].g / sums[c].count);
        centroids[c].b = Math.round(sums[c].b / sums[c].count);
        centroids[c].hex = rgbToHex(
          centroids[c].r,
          centroids[c].g,
          centroids[c].b,
        );
      }
    }
  }

  return centroids;
}

/**
 * 処理済み画像コンテキストとピクセルデータ保持クラス
 */
export class ProcessedImage {
  constructor() {
    this.sourceImage = null;
    this.originalWidth = 0;
    this.originalHeight = 0;
    this.aspectRatio = 1.0;

    // グリッド化ドット絵データ
    this.gridWidth = 25;
    this.gridHeight = 25;
    this.totalPixels = 625;
    this.gridColors = [];

    // 減色パレット (デフォルト: 原画そのまま true)
    this.currentPalette = [];
    this.quantizeMode = "true"; // "adaptive" | "retro" | "true"
    this.paletteColorsCount = 8;
    this.retroTheme = "gameboy";

    this.previewCanvas = null;
  }

  /**
   * 画像URLまたはDataURLから画像を確実にロード・デコード
   */
  async loadImageSource(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // data: URL やローカルパスでは crossOrigin を設定しない（CORSエラー・taint防止）
      if (
        typeof imageUrl === "string" &&
        (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))
      ) {
        try {
          const urlObj = new URL(imageUrl, window.location.href);
          if (urlObj.origin !== window.location.origin) {
            img.crossOrigin = "Anonymous";
          }
        } catch {
          img.crossOrigin = "Anonymous";
        }
      }

      img.onload = async () => {
        try {
          // ブラウザの画像デコード完了を確実に待機 (不完全描画・0x0描画を完全に防ぐ)
          if (typeof img.decode === "function") {
            await img.decode().catch(() => {});
          }
        } catch (_) {
          // decode非対応環境は無視して続行
        }

        this.sourceImage = img;
        this.originalWidth = img.naturalWidth || img.width || 500;
        this.originalHeight = img.naturalHeight || img.height || 500;
        let ar = this.originalWidth / this.originalHeight;
        if (!ar || Number.isNaN(ar) || ar <= 0) {
          ar = 1.0;
        }
        this.aspectRatio = ar;
        resolve(this);
      };

      img.onerror = () => {
        // 相対パス ./samples/ で失敗した場合、ルート絶対パス /samples/ で再試行
        if (
          typeof imageUrl === "string" &&
          imageUrl.startsWith("./samples/")
        ) {
          const fallbackUrl = imageUrl.replace("./samples/", "/samples/");
          img.onerror = () => {
            reject(new Error(`画像の読み込みに失敗しました: ${imageUrl}`));
          };
          img.src = fallbackUrl;
          return;
        }
        reject(new Error(`画像の読み込みに失敗しました: ${imageUrl}`));
      };

      img.src = imageUrl;
    });
  }

  /**
   * 指定目標オブジェクト数に合わせてグリッド解像度を計算し、ドット絵化＆減色
   */
  process(options = {}) {
    if (!this.sourceImage) return;

    const targetObjectCount = options.targetObjectCount || 600;
    this.quantizeMode = options.quantizeMode || this.quantizeMode;
    this.paletteColorsCount =
      options.paletteColorsCount || this.paletteColorsCount;
    if (options.retroTheme) this.retroTheme = options.retroTheme;

    // アスペクト比に合わせてグリッド解像度を決定 (Gw * Gh ≈ targetObjectCount)
    const ar = this.aspectRatio;
    this.gridWidth = Math.max(
      12,
      Math.round(Math.sqrt(targetObjectCount * ar)),
    );
    this.gridHeight = Math.max(
      12,
      Math.round(Math.sqrt(targetObjectCount / ar)),
    );
    this.totalPixels = this.gridWidth * this.gridHeight;

    // 一時オフスクリーンキャンバスでサンプリング
    const offscreen = document.createElement("canvas");
    offscreen.width = this.gridWidth;
    offscreen.height = this.gridHeight;
    const ctx = offscreen.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    // 透過PNG・SVGの透明部分が黒(0,0,0)になるのを防ぐため、白背景で初期化
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.gridWidth, this.gridHeight);
    ctx.drawImage(this.sourceImage, 0, 0, this.gridWidth, this.gridHeight);

    const imgData = ctx.getImageData(
      0,
      0,
      this.gridWidth,
      this.gridHeight,
    ).data;
    const rawPixels = [];

    for (let i = 0; i < imgData.length; i += 4) {
      rawPixels.push({
        r: imgData[i],
        g: imgData[i + 1],
        b: imgData[i + 2],
      });
    }

    // パレットの決定
    let activePalette = [];
    if (this.quantizeMode === "adaptive") {
      activePalette = extractAdaptivePalette(
        rawPixels,
        this.paletteColorsCount,
      );
    } else if (this.quantizeMode === "retro") {
      activePalette =
        RETRO_PALETTES[this.retroTheme] || RETRO_PALETTES.gameboy;
    }
    this.currentPalette = activePalette;

    // 各セルの減色・マッピング
    this.gridColors = [];
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const index = y * this.gridWidth + x;
        const orig = rawPixels[index];

        if (this.quantizeMode === "true" || activePalette.length === 0) {
          this.gridColors.push({
            r: orig.r,
            g: orig.g,
            b: orig.b,
            hex: rgbToHex(orig.r, orig.g, orig.b),
            origR: orig.r,
            origG: orig.g,
            origB: orig.b,
          });
          continue;
        }

        // 最も近いパレット色を探索
        let bestDist = Number.POSITIVE_INFINITY;
        let bestColor = activePalette[0];

        for (const palColor of activePalette) {
          const dist = calculateColorDistance(
            orig.r,
            orig.g,
            orig.b,
            palColor.r,
            palColor.g,
            palColor.b,
          );
          if (dist < bestDist) {
            bestDist = dist;
            bestColor = palColor;
          }
        }

        this.gridColors.push({
          r: bestColor.r,
          g: bestColor.g,
          b: bestColor.b,
          hex: bestColor.hex,
          origR: orig.r,
          origG: orig.g,
          origB: orig.b,
        });
      }
    }

    this.renderPreviewCanvas();
  }

  /**
   * UI表示用のドット絵拡大キャンバスを生成
   */
  renderPreviewCanvas() {
    const scale = Math.max(4, Math.floor(280 / this.gridWidth));
    const canvas = document.createElement("canvas");
    canvas.width = this.gridWidth * scale;
    canvas.height = this.gridHeight * scale;
    const ctx = canvas.getContext("2d");

    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const color = this.gridColors[y * this.gridWidth + x];
        ctx.fillStyle = color.hex;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    this.previewCanvas = canvas;
    return canvas;
  }

  /**
   * 減色後のグリッドセル群から、出現頻度の高い主要カラーリストを降順で算出
   * (第0要素が最頻色＝背景と推定される色)
   */
  getDominantColors(limit = 8) {
    if (!this.gridColors || this.gridColors.length === 0) {
      return [];
    }

    const total = this.gridColors.length;
    const isTrueColor = this.quantizeMode === "true";
    const buckets = new Map();

    for (let i = 0; i < total; i++) {
      const c = this.gridColors[i];
      let key = c.hex.toUpperCase();

      if (isTrueColor) {
        // True Color時はRGB各成分を16単位で丸めて背景領域の微小ノイズを吸収
        const qr = Math.min(255, Math.round(c.r / 16) * 16);
        const qg = Math.min(255, Math.round(c.g / 16) * 16);
        const qb = Math.min(255, Math.round(c.b / 16) * 16);
        key = rgbToHex(qr, qg, qb).toUpperCase();
      }

      const existing = buckets.get(key) || {
        hex: isTrueColor ? key : c.hex.toUpperCase(),
        r: c.r,
        g: c.g,
        b: c.b,
        count: 0,
      };
      existing.count++;
      buckets.set(key, existing);
    }

    const sorted = Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((item) => ({
        hex: item.hex,
        r: item.r,
        g: item.g,
        b: item.b,
        count: item.count,
        percent: Math.max(1, Math.round((item.count / total) * 100)),
      }));

    return sorted;
  }

  /**
   * 正規化座標 (u, v) ∈ [0, 1]^2 からドット絵の色を取得
   */
  sampleColorAtNormalized(u, v) {
    if (!this.gridColors || this.gridColors.length === 0) {
      return { r: 200, g: 200, b: 200, hex: "#C8C8C8" };
    }
    const clampedU = Math.max(0, Math.min(0.999, u));
    const clampedV = Math.max(0, Math.min(0.999, v));

    const gridX = Math.floor(clampedU * this.gridWidth);
    const gridY = Math.floor(clampedV * this.gridHeight);
    const index = gridY * this.gridWidth + gridX;

    return (
      this.gridColors[index] || {
        r: 200,
        g: 200,
        b: 200,
        hex: "#C8C8C8",
      }
    );
  }

  /**
   * 物理空間内のコンテナ枠 (bounds: { left, right, top, bottom }) からの色サンプリング
   */
  sampleColorAtWorld(x, y, containerBounds) {
    const width = containerBounds.right - containerBounds.left;
    const height = containerBounds.bottom - containerBounds.top;
    if (width <= 0 || height <= 0) {
      return { r: 255, g: 255, b: 255, hex: "#FFFFFF" };
    }

    const u = (x - containerBounds.left) / width;
    const v = (y - containerBounds.top) / height;

    return this.sampleColorAtNormalized(u, v);
  }
}

// シングルトンインスタンス
export const currentProcessedImage = new ProcessedImage();
