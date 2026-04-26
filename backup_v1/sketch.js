// Teachable Machine Audio Classification with GIF visuals
// Modified for four classes: Background Noise, shake, knock, clap

// Storing the label

let label = "waiting...";
let confidence = 0;

let classifier;
// Local model path - update this when model files are added
// Use absolute URL for model - ml5 requires http/https
let modelURL = window.location.origin + '/assets/model/model.json';

let isStarted = false;

let knockSound, shakeMusic, clapSound;
let soundsLoaded = false;

let currentPlayingSound = null;
let soundStartTime = 0;
let soundDuration = 6000; // 音乐播放时间 1000=1s
let isPlaying = false;

// 视觉淡入淡出（音乐播放→淡入；播放结束→淡出）
let visualFade = 0;          // 0~1
let visualFadeTarget = 0;    // 目标 0~1
const VISUAL_FADE_IN_SPEED  = 0.12;
const VISUAL_FADE_OUT_SPEED = 0.08;

// ========== 让波形随音乐波动） ==========
let amp, ampEMA = 0;
const AMP_SMOOTH = 0.8; // 幅度平滑系数（越大越稳）
let currentEnergy = 0;  // 0~1 的音乐能量映射

// ==================== Centered Streamgraph====================
let streams = [];

// 更慢、分层更丰富
const STREAM_LIFESPAN       = 24000; // 单条 band 寿命，留出慢淡出空间
const STREAM_MAX_COUNT      = 14;
const SUBLAYERS_PER_BAND    = 9;     // 子层更多：层次更细
const X_STEP                = 10;    // 横向采样更密
const BASE_BAND_HEIGHT      = 80;    // 略低，避免过满
const BAND_HEIGHT_VARIATION = 38;
const CENTER_ZONE           = 160;   // 围绕中线的上下活动区
const LAYER_NOISE_SCALE     = 0.010; // 噪声频率更低 → 更平滑
const LAYER_SIN_SCALE       = 0.020; // 正弦更缓
const LAYER_TIME_SIN_SPEED  = 0.0010;// 更慢
const LAYER_NOISE_TIME_SPEED= 0.0006;// 更慢
const BAND_AMPL_MIN         = 20;    // 振幅较柔
const BAND_AMPL_MAX         = 38;
const PER_VERTEX_JITTER_Y   = 3.5;   // 细微顶点抖动

// 居中"车道"分层（上下交替散开）
const LANES_PER_KIND = 3;
const laneCounters = { shake: 0, knock: 0, clap: 0 };

// 颜色：三类拉开色相，内部渐变
const palettes = {
  shake: { c1: '#2D7BFF', c2: '#11E5D1' }, // 蓝 → 青（冷）
  knock: { c1: '#FF3A3A', c2: '#B014E8' }, // 红 → 紫
  clap:  { c1: '#FF9F1C', c2: '#C8FF3D' }  // 橙 → 黄绿
};

class StreamBand {
  constructor(kind) {
    this.kind  = kind;
    this.start = millis();
    this.end   = this.start + STREAM_LIFESPAN;

    // ——围绕画布中心分层错落——
    const laneIdx  = (laneCounters[kind]++) % LANES_PER_KIND;
    const laneSpan = CENTER_ZONE / Math.max(1, LANES_PER_KIND - 1);
    const centerY  = height / 2;
    const sign     = (laneIdx % 2 === 0) ? 1 : -1; // 上下交替
    const offset   = Math.floor(laneIdx / 2) * laneSpan;
    this.baseY     = centerY + sign * offset + random(-laneSpan * 0.25, laneSpan * 0.25);

    // 运动/形态参数（更慢、更柔）
    this.noiseSeed  = random(1000);
    this.phase      = random(TWO_PI);
    this.speed      = random(0.00045, 0.0009);       // 噪声时间推进
    this.phaseSpeed = random(0.0005, 0.0012);        // 正弦相位
    this.amplitude  = random(BAND_AMPL_MIN, BAND_AMPL_MAX);
    this.bandHeight = BASE_BAND_HEIGHT + random(-BAND_HEIGHT_VARIATION, BAND_HEIGHT_VARIATION);

    // 细微的整条"慢漂移"（整体呼吸）
    this.driftSeed  = random(1000);
    this.driftMag   = random(6, 10);                 // 上下慢漂幅度

    // 颜色
    const p = palettes[kind] || { c1: '#888', c2: '#bbb' };
    this.c1 = color(p.c1);
    this.c2 = color(p.c2);
  }

  extend() {
    this.end = millis() + STREAM_LIFESPAN;
    // 续命时略随当前能量放大
    this.bandHeight = lerp(this.bandHeight, this.bandHeight * (1 + 0.25 * currentEnergy), 0.3);
    this.amplitude  = lerp(this.amplitude,  this.amplitude  * (1 + 0.30 * currentEnergy), 0.3);
  }

  isAlive() { return millis() < this.end; }

  draw() {
    const now   = millis();
    const tNorm = constrain(map(now, this.start, this.end, 0, 1), 0, 1);

    // 双缓动（更圆润）：smoothstep → cos
    const smooth = (t)=>t*t*(3-2*t);
    const ease01 = 0.5 - 0.5 * cos(smooth(tNorm) * PI);

    // 随音乐能量的呼吸：高度/振幅按 currentEnergy 微调
    const energyBoost = 1 + 0.55 * currentEnergy;
    const liveHeight  = this.bandHeight * (0.52 + 0.95 * ease01) * energyBoost;
    const ampNow      = this.amplitude  * (0.85 + 0.6 * currentEnergy);

    // 整体"慢漂移"
    const drift = (noise(this.driftSeed, now * 0.00025) - 0.5) * 2 * this.driftMag;

    // 填充 + 极浅顶部描边
    noStroke();
    for (let i = 0; i < SUBLAYERS_PER_BAND; i++) {
      // 渐变颜色 & 透明度（叠加视觉淡入/淡出）
      const k    = i / Math.max(1, SUBLAYERS_PER_BAND - 1);
      const col  = lerpColor(this.c1, this.c2, k);
      const alpha = 150 * (1 - tNorm) * (1 - 0.07 * i) * visualFade;
      col.setAlpha(alpha);
      fill(col);

      // 每层微小时间/相位差，增强层次但保留优雅
      const layerPhaseOffset = i * 0.24;
      const layerTimeMul     = 1 + i * 0.06;

      // ——— 填充 ———
      beginShape();
      for (let x = 0; x <= width; x += X_STEP) {
        const nx = (x + i * 9) * LAYER_NOISE_SCALE;
        const nt = now * (this.speed * layerTimeMul) + this.noiseSeed + i * 100;
        const n  = noise(nx, nt);
        const s  = sin(x * LAYER_SIN_SCALE + this.phase + now * (this.phaseSpeed + LAYER_TIME_SIN_SPEED) + layerPhaseOffset);

        // 细微顶点抖动 + 层厚
        const jitter = (noise(x * 0.06, now * 0.004 + i * 10) - 0.5) * PER_VERTEX_JITTER_Y * 2 * 0.7;
        const layerOffset = map(i, 0, SUBLAYERS_PER_BAND - 1, -liveHeight, liveHeight) * 0.45; // 围绕中线上下展开

        const y =
          this.baseY + drift
          + layerOffset
          + (n - 0.5) * (ampNow * 1.8)
          + s * (ampNow * 0.8)
          + jitter;

        vertex(x, y);
      }
      vertex(width, height);
      vertex(0, height);
      endShape(CLOSE);

      // ——— 顶部极浅描边（提升层次感）———
      stroke(255, 20 * visualFade);
      noFill();
      beginShape();
      for (let x = 0; x <= width; x += X_STEP) {
        const nx = (x + i * 9) * LAYER_NOISE_SCALE;
        const nt = now * (this.speed * layerTimeMul) + this.noiseSeed + i * 100;
        const n  = noise(nx, nt);
        const s  = sin(x * LAYER_SIN_SCALE + this.phase + now * (this.phaseSpeed + LAYER_TIME_SIN_SPEED) + layerPhaseOffset);
        const jitter = (noise(x * 0.06, now * 0.004 + i * 10) - 0.5) * PER_VERTEX_JITTER_Y * 2 * 0.7;
        const layerOffset = map(i, 0, SUBLAYERS_PER_BAND - 1, -liveHeight, liveHeight) * 0.45;

        const y =
          this.baseY + drift
          + layerOffset
          + (n - 0.5) * (ampNow * 1.8)
          + s * (ampNow * 0.8)
          + jitter;

        vertex(x, y);
      }
      endShape();
      noStroke();
    }
  }
}

// 背景色
function bgColorFor(label) {
  if (label == "shake") return [30, 55, 85];
  if (label == "knock") return [80, 30, 55];
  if (label == "clap")  return [85, 60, 30];
  return [20, 25, 40];
}

// ==================== 资源加载 ====================
let modelLoaded = false;
let classificationRunning = false;
let mic; // Explicit microphone input

function preload() {
  console.log('[DEBUG] preload() starting...');
  console.log('[DEBUG] ml5 version:', ml5.version);

  // Get audio context for classifier
  const audioCtx = getAudioContext();
  console.log('[DEBUG] AudioContext state:', audioCtx.state);

  // Load model with audio context
  classifier = ml5.soundClassifier(modelURL, audioCtx, modelReady);

  // Load audio files with error handling
  knockSound = loadSound('assets/audio/knock.mp3', checkSoundsLoaded, soundLoadError.bind(null, 'knock.mp3'));
  shakeMusic = loadSound('assets/audio/shake.mp3', checkSoundsLoaded, soundLoadError.bind(null, 'shake.mp3'));
  clapSound  = loadSound('assets/audio/clap.mp3',  checkSoundsLoaded, soundLoadError.bind(null, 'clap.mp3'));
}

function soundLoadError(filename, err) {
  console.error(`MISSING AUDIO: assets/audio/${filename} - ${err?.message || 'file not found'}`);
}

function modelError(err) {
  console.error('[DEBUG] modelError() fired!');
  console.error('Model load error:', err);
  label = "Model error: " + (err ? err.message : 'unknown');
}

function checkSoundsLoaded() {
  const missing = [];
  if (!knockSound || !knockSound.file) missing.push('knock.mp3');
  if (!shakeMusic || !shakeMusic.file) missing.push('shake.mp3');
  if (!clapSound || !clapSound.file) missing.push('clap.mp3');

  if (missing.length > 0) {
    console.warn(`Missing audio files: ${missing.join(', ')}`);
    console.warn('Place audio files in: assets/audio/');
    return;
  }

  soundsLoaded = true;
  knockSound.setVolume(0.7);
  shakeMusic.setVolume(0.5);
  clapSound.setVolume(0.6);
  knockSound.setLoop(true);
  shakeMusic.setLoop(true);
  clapSound.setLoop(true);
}

function modelReady() {
  console.log('[DEBUG] modelReady() fired - model loaded successfully');
  modelLoaded = true;
  label = "Click to start";

  // Fallback: if modelReady didn't fire in 3 seconds, model might not have loaded
  setTimeout(() => {
    if (!modelLoaded) {
      console.error('[DEBUG] Model failed to load - no callback received');
      label = "Model load failed - check console";
    }
  }, 3000);
}

// ==================== 基本设置与循环 ====================
function setup() {
  createCanvas(640, 520);
  textAlign(CENTER, CENTER);

  // Explicitly create microphone input
  mic = new p5.AudioIn();
  console.log('[DEBUG] AudioIn created');

  // 音乐能量分析器
  amp = new p5.Amplitude(AMP_SMOOTH);
}

function mousePressed() {
  console.log('[DEBUG] mousePressed() isStarted=', isStarted, 'classifier=', !!classifier, 'mic=', !!mic);
  if (!isStarted && classifier) {
    isStarted = true;
    label = "Starting...";
    userStartAudio();   // 解锁音频

    // Explicitly start microphone
    if (mic) {
      mic.start();
      console.log('[DEBUG] Microphone started');
    }

    console.log('[DEBUG] Calling classifyAudio()...');
    classifyAudio();
  }
}

function classifyAudio() {
  console.log('[DEBUG] classifyAudio() called, classifier=', !!classifier, 'running=', classificationRunning);
  if (classifier && !classificationRunning) {
    classificationRunning = true;
    try {
      classifier.classify(gotResults);
      console.log('[DEBUG] classifier.classify() started successfully');
    } catch (e) {
      console.error('[DEBUG] classifier.classify() error:', e);
    }
  }
}

function draw() {
  // 背景渐变（与当前状态弱相关）
  const displayLabel = isPlaying ? currentPlayingSound : label;
  const base = bgColorFor(displayLabel);
  for (let i = 0; i <= height; i++) {
    const inter = i / height;
    const c = lerpColor(color(base[0], base[1], base[2]), color(20, 25, 40), inter);
    stroke(c);
    line(0, i, width, i);
  }

  // 视觉淡入/淡出推进
  const fadeSpeed = visualFadeTarget > visualFade ? VISUAL_FADE_IN_SPEED : VISUAL_FADE_OUT_SPEED;
  visualFade = lerp(visualFade, visualFadeTarget, fadeSpeed);
  if (abs(visualFade - visualFadeTarget) < 0.01) visualFade = visualFadeTarget;

  // 音乐能量采样（驱动波动）
  if (isPlaying) {
    const lvl = amp.getLevel();                     // 0..~1
    ampEMA = lerp(ampEMA, lvl, 0.2);                // 再次平滑
    currentEnergy = constrain(map(ampEMA, 0.01, 0.18, 0, 1), 0, 1);
  } else {
    currentEnergy = 0;
  }

  updatePlayback();

  // 居中 streamgraph（只在有视觉不透明度时绘制）
  if (visualFade > 0.01) drawStreams();

  // 文本信息
  textSize(26);
  fill(255, 230);
  text(displayLabel, width / 2, height - 58);

  if (confidence > 0 && isStarted) {
    textSize(14);
    fill(255, 180);
    text(`Confidence: ${(confidence * 100).toFixed(1)}%`, width / 2, height - 36);
  }

  if (isPlaying) {
    const remainingTime = Math.max(0, soundDuration - (millis() - soundStartTime));
    textSize(12);
    fill(255, 200);
    text(`Playing: ${(remainingTime / 1000).toFixed(1)}s remaining`, width / 2, height - 20);
  }

  // 顶部提示
  displayInstructions();
}

// ==================== Streamgraph 绘制与管理 ====================
function drawStreams() {
  streams = streams.filter(b => b && b.isAlive());
  // 让早期的在下层（或改为按 baseY 排序也可）
  streams.sort((a, b) => a.start - b.start);
  for (const band of streams) band.draw();
}

// 新建或续命 band（同类续命，不同类新增）
function spawnOrExtendBand(kind) {
  // 每次检测都创建新的动画带 - 允许叠加
  streams.push(new StreamBand(kind));
  if (streams.length > STREAM_MAX_COUNT) streams.splice(0, streams.length - STREAM_MAX_COUNT);
}

// ==================== 文本提示 ====================
function displayInstructions() {
  // Debug info at top
  textSize(10);
  fill(255, 100);
  let debugInfo = `Model: ${modelLoaded ? 'OK' : 'loading'} | Sounds: ${soundsLoaded ? 'OK' : 'loading'} | Running: ${classificationRunning}`;
  text(debugInfo, width / 2, 14);

  if (!isStarted) {
    textSize(14);
    fill(255, 140);
    text("Click anywhere to start listening", width / 2, 28);

    textSize(12);
    fill(255, 100);
    text(soundsLoaded ? "All audio files loaded - Ready!" : "Loading audio files...", width / 2, 46);
  } else {
    textSize(12);
    fill(255, 100);
    text("Listening... Press R to reset, M to mute", width / 2, 28);
  }
}

// ==================== 播放逻辑（与视觉联动） ====================
function updatePlayback() {
  // 达到播放窗口 → 停止声音，触发视觉淡出
  if (isPlaying && millis() - soundStartTime >= soundDuration) {
    stopCurrentSound();
    isPlaying = false;
    currentPlayingSound = null;
    visualFadeTarget = 0; // 整体淡出
  }
}

const CONFIDENCE_THRESHOLD = 0.5; // TEMPORARILY LOWERED FOR DEBUGGING

function playCorrespondingSound(detectedLabel) {
  console.log('[DEBUG] playCorrespondingSound() called with:', detectedLabel);
  console.log('[DEBUG] soundsLoaded=', soundsLoaded, 'confidence=', confidence, 'threshold=', CONFIDENCE_THRESHOLD);

  if (!soundsLoaded) {
    console.log('[DEBUG] BLOCKED: soundsLoaded is false');
    return;
  }
  if (confidence < CONFIDENCE_THRESHOLD) {
    console.log('[DEBUG] BLOCKED: confidence', confidence, '<' , CONFIDENCE_THRESHOLD);
    return;
  }
  if (!["shake", "knock", "clap"].includes(detectedLabel)) {
    console.log('[DEBUG] BLOCKED: label not in [shake, knock, clap], got:', detectedLabel);
    return;
  }

  let newSound = null;
  if (detectedLabel === "shake") newSound = shakeMusic;
  if (detectedLabel === "knock") newSound = knockSound;
  if (detectedLabel === "clap")  newSound = clapSound;

  if (!newSound) {
    console.log('[DEBUG] BLOCKED: sound object not found for:', detectedLabel);
    return;
  }

  console.log('[DEBUG] Playing sound:', detectedLabel);
  // 切换或首次播放
  if (currentPlayingSound !== detectedLabel || !isPlaying) {
    // 不再清除旧动画 - 允许多个动画叠加
    stopCurrentSound();
    newSound.play();
    amp.setInput(newSound); // 关键：将音乐接入振幅分析器

    currentPlayingSound = detectedLabel;
    isPlaying = true;
    soundStartTime = millis();
    visualFadeTarget = 1; // 视觉淡入

    // 切曲目时重置能量基线
    ampEMA = 0;
  } else {
    // 同类再次触发：延长播放窗口，并保持视觉满幅
    soundStartTime = millis();
    visualFadeTarget = 1;
  }

  // 新建或续命 居中波形
  spawnOrExtendBand(detectedLabel);
}

function stopCurrentSound() {
  if (knockSound?.isPlaying()) knockSound.stop();
  if (shakeMusic?.isPlaying()) shakeMusic.stop();
  if (clapSound?.isPlaying())  clapSound.stop();
}

// ==================== 分类回调与按键 ====================
function gotResults(error, results) {
  // Skip if not started (R was pressed)
  if (!isStarted) {
    console.log('[DEBUG] gotResults() ignored - not started');
    return;
  }

  console.log('[DEBUG] gotResults() fired', error ? 'ERROR: ' + error : '', results);
  if (error) {
    console.error('[DEBUG] Classification error:', error);
    label = "Error: " + error.message;
    return;
  }
  if (results && results.length > 0) {
    // Only update label and trigger sound when actively started and not already playing
    if (isStarted && !isPlaying) {
      label = results[0].label;
      confidence = results[0].confidence;
      console.log('[DEBUG] Result:', label, 'confidence:', confidence);
      playCorrespondingSound(label);
    }
  } else {
    console.log('[DEBUG] No results returned');
  }
  // Don't auto-restart - ml5 classifier handles continuous streaming
}

function keyPressed() {
  // Manual bypass test - press T to test clap sound directly
  if (key === 't' || key === 'T') {
    console.log('[DEBUG] MANUAL BYPASS TEST - playing clap');
    if (clapSound && soundsLoaded) {
      stopCurrentSound();
      clapSound.play();
      amp.setInput(clapSound);
      currentPlayingSound = "clap";
      isPlaying = true;
      soundStartTime = millis();
      visualFadeTarget = 1;
      spawnOrExtendBand("clap");
      console.log('[DEBUG] Clap played successfully via manual bypass');
    } else {
      console.log('[DEBUG] MANUAL BYPASS FAILED: clapSound not loaded');
    }
  }

  if (key === ' ') {
    if (!isStarted && classifier) {
      isStarted = true;
      label = "Starting...";
      userStartAudio();
      classifyAudio();
    }
  }

  if (key === 'r' || key === 'R') {
    console.log('[DEBUG] R pressed - resetting');
    isStarted = false;
    classificationRunning = false;
    label = "Click to start";
    confidence = 0;
    isPlaying = false;
    currentPlayingSound = null;
    stopCurrentSound();
    visualFadeTarget = 0;
    streams = []; // 清空可视化
  }

  if (key === 'm' || key === 'M') {
    stopCurrentSound();
    isPlaying = false;
    currentPlayingSound = null;
    visualFadeTarget = 0; // 静音也淡出
  }
}
