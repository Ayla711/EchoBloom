// Teachable Machine Audio Classification with GIF visuals
// Modified for four classes: Background Noise, sway, leap, pulse, drift

// Storing the label

let label = "waiting...";
let confidence = 0;

let classifier;
// Local model path - update this when model files are added
// Use absolute URL for both model and metadata - required by ml5
const baseURL = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
let modelURL = baseURL + 'assets/model/model.json';
let metadataURL = baseURL + 'assets/model/metadata.json';

let isStarted = false;

let swaySound, leapSound, pulseSound, driftSound;
let soundsLoaded = false;

let currentPlayingSound = null;
let soundStartTime = 0;
let soundDuration = 6000; // 最小播放时间
let lastValidSound = null;  // 最后识别到的有效声音
let isPlaying = false;
let needsFadeOut = false; // 是否需要淡出
let fadeVolume = 1.0;    // 淡出音量

// 视觉淡入淡出（音乐播放→淡入；播放结束→淡出）
let visualFade = 0;          // 0~1
let visualFadeTarget = 0;    // 目标 0~1
const VISUAL_FADE_IN_SPEED  = 0.3;  // 更快淡入
const VISUAL_FADE_OUT_SPEED = 0.08;

// ========== 让波形随音乐波动） ==========
let amp, ampEMA = 0;
const AMP_SMOOTH = 0.8; // 幅度平滑系数（越大越稳）
let currentEnergy = 0;  // 0~1 的音乐能量映射

// ==================== Centered Streamgraph====================
let streams = [];

// 更慢、分层更丰富
const STREAM_LIFESPAN       = 6000; // 动画寿命，与音频同步 1000=1s
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
const laneCounters = { sway: 0, leap: 0, pulse: 0, drift: 0 };

// 颜色：四类拉开色相，内部渐变
const palettes = {
  sway:  { c1: '#2D7BFF', c2: '#11E5D1' }, // 蓝 → 青（冷）
  leap:  { c1: '#FF3A3A', c2: '#B014E8' }, // 红 → 紫
  pulse: { c1: '#FF9F1C', c2: '#b3011f' }, // 橙 → 红
  drift: { c1: '#FF1493', c2: '#00CED1' }  // 粉红 → 青
};

// 视频资源
let swayVideo, leapVideo, pulseVideo, driftVideo;
let activeVideos = [];

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

// 视频动画类
let videoCache = {}; // 缓存已加载的视频

class VideoAnimation {
  constructor(kind) {
    this.kind = kind;
    this.start = millis();
    this.end = this.start + STREAM_LIFESPAN;
    this.video = videoCache[kind] || null;
    if (!this.video) {
      this.loadVideo(kind);
    }
  }

  loadVideo(kind) {
    if (videoCache[kind]) {
      this.video = videoCache[kind];
      return;
    }
    const videoPath = `assets/mov/${kind}.webm`;
    this.video = createVideo([videoPath], () => {
      if (this.video) {
        this.video.elt.muted = true;
        this.video.loop();
      }
    });
    this.video.hide();
    videoCache[kind] = this.video;
  }

  isAlive() { return millis() < this.end; }
}

// 背景色
function bgColorFor(label) {
  if (label == "sway")  return [30, 55, 85];
  if (label == "leap")  return [80, 30, 55];
  if (label == "pulse") return [85, 60, 30];
  if (label == "drift") return [60, 30, 70];
  return [20, 25, 40];
}

// 标签显示名称映射
function displayNameFor(label) {
  if (label == "sway")  return { cn: "荡漾", en: "Sway" };
  if (label == "leap")  return { cn: "雀跃", en: "Leap" };
  if (label == "pulse") return { cn: "律动", en: "Pulse" };
  if (label == "drift") return { cn: "放空", en: "Drift" };
  if (label == "Background Noise") return { cn: "背景噪音", en: "Background" };
  return { cn: label, en: label };
}

// ==================== 资源加载 ====================
let modelLoaded = false;
let classificationRunning = false;
let mic; // Explicit microphone input

function preload() {
  console.log('[DEBUG] preload() starting...');
  console.log('[DEBUG] ml5 version:', ml5.version);
  console.log('[DEBUG] baseURL:', baseURL);
  console.log('[DEBUG] modelURL:', modelURL);
  console.log('[DEBUG] metadataURL:', metadataURL);

  // Get audio context for classifier
  const audioCtx = getAudioContext();
  console.log('[DEBUG] AudioContext state:', audioCtx.state);

  // Load model with audio context and metadata
  classifier = ml5.soundClassifier(modelURL, { metadata: metadataURL, audioContext: audioCtx }, modelReady);

  // Load audio files with error handling
  swaySound  = loadSound('assets/audio/sway.MP3',  checkSoundsLoaded, soundLoadError.bind(null, 'sway.MP3'));
  leapSound  = loadSound('assets/audio/leap.MP3',  checkSoundsLoaded, soundLoadError.bind(null, 'leap.MP3'));
  pulseSound = loadSound('assets/audio/pulse.mp3', checkSoundsLoaded, soundLoadError.bind(null, 'pulse.mp3'));
  driftSound = loadSound('assets/audio/drift.MP3', checkSoundsLoaded, soundLoadError.bind(null, 'drift.MP3'));

  // Video files will be loaded on demand in VideoAnimation class
  // No preload video loading to avoid blocking
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
  if (!swaySound  || !swaySound.file)  missing.push('sway.mp3');
  if (!leapSound  || !leapSound.file)  missing.push('leap.mp3');
  if (!pulseSound || !pulseSound.file) missing.push('pulse.mp3');
  if (!driftSound || !driftSound.file) missing.push('drift.mp3');

  if (missing.length > 0) {
    console.warn(`Missing audio files: ${missing.join(', ')}`);
    console.warn('Place audio files in: assets/audio/');
    return;
  }

  soundsLoaded = true;
  swaySound.setVolume(0.7);
  leapSound.setVolume(0.7);
  pulseSound.setVolume(0.6);
  driftSound.setVolume(0.5);
}

function modelReady() {
  console.log('[DEBUG] modelReady() fired - model loaded successfully');
  modelLoaded = true;
  label = "Click to start";

  //// Fallback: if modelReady didn't fire in 3 seconds, model might not have loaded
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

  // 视频绘制（在 streamgraph 之上）
  if (visualFade > 0.01) drawVideos();

  // 文本信息
  textSize(26);
  fill(255, 230);
  const name = displayNameFor(displayLabel);
  text(name.cn, width / 2, height - 90);
  textSize(18);
  fill(255, 180);
  text(name.en, width / 2, height - 60);

  if (confidence > 0 && isStarted) {
    textSize(14);
    fill(255, 180);
    text(`Confidence: ${(confidence * 100).toFixed(1)}%`, width / 2, height - 40);
  }

  if (isPlaying && soundStartTime > 0) {
    const elapsed = millis() - soundStartTime;
    const remainingTime = Math.max(0, soundDuration - elapsed);
    textSize(12);
    fill(255, 200);
    text(`Playing: ${(remainingTime / 1000).toFixed(1)}s remaining`, width / 2, height - 22);
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

// ==================== GIF 绘制与管理 ====================
// ==================== 视频绘制与管理 ====================
function drawVideos() {
  activeVideos = activeVideos.filter(v => v && v.isAlive());
  activeVideos.sort((a, b) => a.start - b.start); // 早期在下层

  for (const vid of activeVideos) {
    if (vid.video && vid.video.loadedmetadata) {
      // 居中显示，保持比例
      let scale = Math.min(width / vid.video.width, height / vid.video.height);
      let w = vid.video.width * scale;
      let h = vid.video.height * scale;
      let x = (width - w) / 2;
      let y = (height - h) / 2;

      // 随 visualFade 淡入淡出
      let alpha = visualFade * 255;
      tint(255, alpha);
      image(vid.video, x, y, w, h);
      noTint();
    }
  }
}

// 新建或续命 band（同类替换，不同类新增）
function spawnOrExtendBand(kind) {
  // 检查是否已有同类的视频/动画，有则替换（更新 start time）
  const existingIdx = activeVideos.findIndex(v => v.kind === kind);
  if (existingIdx !== -1) {
    // 已有同类的视频，更新其时间
    activeVideos[existingIdx].start = millis();
    activeVideos[existingIdx].end = millis() + STREAM_LIFESPAN;
    if (streams[existingIdx]) {
      streams[existingIdx].start = millis();
      streams[existingIdx].end = millis() + STREAM_LIFESPAN;
    }
  } else {
    // 不同类，新增
    streams.push(new StreamBand(kind));
    activeVideos.push(new VideoAnimation(kind));
  }

  if (streams.length > STREAM_MAX_COUNT) streams.splice(0, streams.length - STREAM_MAX_COUNT);
  if (activeVideos.length > STREAM_MAX_COUNT) activeVideos.splice(0, activeVideos.length - STREAM_MAX_COUNT);
}

// 更新现有动画的时间（不新增）
function extendAnimation(kind) {
  const videoIdx = activeVideos.findIndex(v => v.kind === kind);
  if (videoIdx !== -1) {
    activeVideos[videoIdx].start = millis();
    activeVideos[videoIdx].end = millis() + STREAM_LIFESPAN;
  }
  const streamIdx = streams.findIndex(s => s.kind === kind);
  if (streamIdx !== -1) {
    streams[streamIdx].start = millis();
    streams[streamIdx].end = millis() + STREAM_LIFESPAN;
  }
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
  // 处理淡出
  if (needsFadeOut) {
    fadeVolume -= 0.033; // 0.5秒淡出（约15帧）
    if (fadeVolume <= 0) {
      fadeVolume = 0;
      stopCurrentSound();
      needsFadeOut = false;
      isPlaying = false;
      label = "Background Noise";
      visualFadeTarget = 0;
    } else {
      // 降低音量
      if (swaySound?.isPlaying())  swaySound.setVolume(0.7 * fadeVolume);
      if (leapSound?.isPlaying())  leapSound.setVolume(0.7 * fadeVolume);
      if (pulseSound?.isPlaying()) pulseSound.setVolume(0.6 * fadeVolume);
      if (driftSound?.isPlaying()) driftSound.setVolume(0.5 * fadeVolume);
    }
    return;
  }

  // 检查是否已超过最小播放时间，可以停止
  if (isPlaying && soundStartTime > 0 && millis() - soundStartTime >= soundDuration) {
    // 等待识别到 Background Noise 才停止（由 gotResults 处理）
    // 这里只做一个保险：如果真的什么都没识别到，6秒后可以停止
    if (!lastValidSound || !["sway", "leap", "pulse", "drift"].includes(lastValidSound)) {
      fadeOutAndStop();
    }
  }
}

const CONFIDENCE_THRESHOLD = 0.95;

function playCorrespondingSound(detectedLabel, conf) {
  const confValue = conf !== undefined ? conf : confidence;
  console.log('[DEBUG] playCorrespondingSound() called with:', detectedLabel, 'conf:', confValue);
  console.log('[DEBUG] soundsLoaded=', soundsLoaded);

  if (!soundsLoaded) {
    console.log('[DEBUG] BLOCKED: soundsLoaded is false');
    return;
  }
  if (confValue < CONFIDENCE_THRESHOLD) {
    console.log('[DEBUG] BLOCKED: confidence', confValue, '<' , CONFIDENCE_THRESHOLD);
    return;
  }
  if (!["sway", "leap", "pulse", "drift"].includes(detectedLabel)) {
    console.log('[DEBUG] BLOCKED: label not in [sway, leap, pulse, drift], got:', detectedLabel);
    return;
  }

  let newSound = null;
  if (detectedLabel === "sway")  newSound = swaySound;
  if (detectedLabel === "leap")  newSound = leapSound;
  if (detectedLabel === "pulse") newSound = pulseSound;
  if (detectedLabel === "drift") newSound = driftSound;

  if (!newSound) {
    console.log('[DEBUG] BLOCKED: sound object not found for:', detectedLabel);
    return;
  }

  console.log('[DEBUG] Playing sound:', detectedLabel);
  // 切换或首次播放
  if (currentPlayingSound !== detectedLabel || !isPlaying) {
    // 取消淡出，恢复音量
    needsFadeOut = false;
    fadeVolume = 1.0;
    if (swaySound)  swaySound.setVolume(0.7);
    if (leapSound)  leapSound.setVolume(0.7);
    if (pulseSound) pulseSound.setVolume(0.6);
    if (driftSound) driftSound.setVolume(0.5);

    newSound.play();
    amp.setInput(newSound);

    currentPlayingSound = detectedLabel;
    lastValidSound = detectedLabel;
    soundStartTime = millis();
    isPlaying = true;
    visualFadeTarget = 1;
    ampEMA = 0;
  } else {
    soundStartTime = millis();
    visualFadeTarget = 1;
  }

  // 新建或续命 居中波形
  spawnOrExtendBand(detectedLabel);
}

// 立即停止（用于主动切换）
function stopCurrentSound() {
  if (swaySound?.isPlaying())  swaySound.stop();
  if (leapSound?.isPlaying())  leapSound.stop();
  if (pulseSound?.isPlaying()) pulseSound.stop();
  if (driftSound?.isPlaying()) driftSound.stop();
}

// 淡出停止（目前暂时用直接停止）
function fadeOutAndStop() {
  needsFadeOut = true;
  fadeVolume = 1.0;
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
    const detectedLabel = results[0].label;
    const conf = results[0].confidence;

    console.log('[DEBUG] Raw result:', detectedLabel, 'conf:', conf.toFixed(3));

    // 正在播放时
    if (isPlaying) {
      // 识别到4种声音之一
      if (conf >= CONFIDENCE_THRESHOLD && ["sway", "leap", "pulse", "drift"].includes(detectedLabel)) {
        // 重置6秒计时
        soundStartTime = millis();
        lastValidSound = detectedLabel;
        label = detectedLabel;
        confidence = conf;
        console.log('[DEBUG] Valid sound:', detectedLabel);

        // 如果是不同的声音，切换播放
        if (detectedLabel !== currentPlayingSound || !isPlaying) {
          console.log('[DEBUG] Switching to:', detectedLabel);
          stopCurrentSound();
          playCorrespondingSound(detectedLabel, conf);
        } else {
          // 相同声音在播放，只更新动画
          console.log('[DEBUG] Same sound, updating animation only');
          extendAnimation(detectedLabel);
          visualFadeTarget = 1;
        }
        return;
      }

      // 识别到其他声音（包括 Background Noise）或无效
      // 需要等待6秒后才停止
      if (millis() - soundStartTime >= soundDuration) {
        // 已过6秒，停止（淡出）
        label = "Background Noise";
        confidence = conf;
        fadeOutAndStop();
        isPlaying = false;
        lastValidSound = null;
        currentPlayingSound = null;
        visualFadeTarget = 0;
        console.log('[DEBUG] 6s elapsed, stopped');
      }
      return;
    }

    // 未在播放：首次识别到有效声音时启动
    if (conf >= CONFIDENCE_THRESHOLD && ["sway", "leap", "pulse", "drift"].includes(detectedLabel)) {
      label = detectedLabel;
      confidence = conf;
      console.log('[DEBUG] Valid Result:', detectedLabel, 'confidence:', conf);
      lastValidSound = detectedLabel;
      playCorrespondingSound(detectedLabel);
    } else if (detectedLabel === "Background Noise") {
      label = "Background Noise";
      confidence = conf;
    }
  }
  // Don't auto-restart - ml5 classifier handles continuous streaming
}

function keyPressed() {
  // Manual bypass test - T=sway, Y=leap, U=pulse, I=drift
  if (key === 't' || key === 'T') {
    console.log('[DEBUG] MANUAL BYPASS TEST - playing sway');
    if (swaySound && soundsLoaded) {
      stopCurrentSound();
      swaySound.play();
      amp.setInput(swaySound);
      currentPlayingSound = "sway";
      lastValidSound = "sway";
      soundStartTime = millis();
      isPlaying = true;
      soundStartTime = millis();
      visualFadeTarget = 1;
      spawnOrExtendBand("sway");
      console.log('[DEBUG] Sway played successfully via manual bypass');
    } else {
      console.log('[DEBUG] MANUAL BYPASS FAILED: swaySound not loaded');
    }
  }

  if (key === 'y' || key === 'Y') {
    console.log('[DEBUG] MANUAL BYPASS TEST - playing leap');
    if (leapSound && soundsLoaded) {
      stopCurrentSound();
      leapSound.play();
      amp.setInput(leapSound);
      currentPlayingSound = "leap";
      lastValidSound = "leap";
      soundStartTime = millis();
      isPlaying = true;
      soundStartTime = millis();
      visualFadeTarget = 1;
      spawnOrExtendBand("leap");
      console.log('[DEBUG] Leap played successfully via manual bypass');
    } else {
      console.log('[DEBUG] MANUAL BYPASS FAILED: leapSound not loaded');
    }
  }

  if (key === 'u' || key === 'U') {
    console.log('[DEBUG] MANUAL BYPASS TEST - playing pulse');
    if (pulseSound && soundsLoaded) {
      stopCurrentSound();
      pulseSound.play();
      amp.setInput(pulseSound);
      currentPlayingSound = "pulse";
      lastValidSound = "pulse";
      soundStartTime = millis();
      isPlaying = true;
      soundStartTime = millis();
      visualFadeTarget = 1;
      spawnOrExtendBand("pulse");
      console.log('[DEBUG] Pulse played successfully via manual bypass');
    } else {
      console.log('[DEBUG] MANUAL BYPASS FAILED: pulseSound not loaded');
    }
  }

  if (key === 'i' || key === 'I') {
    console.log('[DEBUG] MANUAL BYPASS TEST - playing drift');
    if (driftSound && soundsLoaded) {
      stopCurrentSound();
      driftSound.play();
      amp.setInput(driftSound);
      currentPlayingSound = "drift";
      lastValidSound = "drift";
      soundStartTime = millis();
      isPlaying = true;
      soundStartTime = millis();
      visualFadeTarget = 1;
      spawnOrExtendBand("drift");
      console.log('[DEBUG] Drift played successfully via manual bypass');
    } else {
      console.log('[DEBUG] MANUAL BYPASS FAILED: driftSound not loaded');
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
    lastValidSound = null;
    currentPlayingSound = null;
    stopCurrentSound();
    visualFadeTarget = 0;
    streams = []; // 清空可视化
    activeVideos = []; // 清空视频
  }

  if (key === 'm' || key === 'M') {
    stopCurrentSound();
    isPlaying = false;
    lastValidSound = null;
    currentPlayingSound = null;
    visualFadeTarget = 0; // 静音也淡出
  }
}
