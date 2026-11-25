import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MODEL_DIR_NAME = 'sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01';

function defaultVoiceRoot() {
  return process.env.CODEX_PET_VOICE_DIR ?? path.join(os.homedir(), '.codex-pet', 'voice');
}

async function findModelFiles(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  const find = (prefix) => entries.find((name) => name.startsWith(prefix) && name.endsWith('.onnx'));
  return {
    encoder: find('encoder'),
    decoder: find('decoder'),
    joiner: find('joiner'),
    tokens: entries.find((name) => name === 'tokens.txt'),
  };
}

function toFloat(data, format) {
  if (format === 'f32') return data;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const value = Number(data[i]);
    if (format === 'f64') out[i] = value;
    else if (format === 'i8') out[i] = value / 128;
    else if (format === 'u8') out[i] = (value - 128) / 128;
    else if (format === 'i16') out[i] = value / 32768;
    else if (format === 'u16') out[i] = (value - 32768) / 32768;
    else if (format === 'i24') out[i] = value / 8388608;
    else if (format === 'u24') out[i] = (value - 8388608) / 8388608;
    else if (format === 'i32') out[i] = value / 2147483648;
    else if (format === 'u32') out[i] = (value - 2147483648) / 2147483648;
    else if (format === 'i64') out[i] = value / 9223372036854775808;
    else if (format === 'u64') out[i] = value / 9223372036854775808;
    else out[i] = value;
  }
  return out;
}

function downmix(data, channels) {
  if (channels <= 1) return data;
  const frames = Math.floor(data.length / channels);
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += data[frame * channels + channel] ?? 0;
    }
    mono[frame] = sum / channels;
  }
  return mono;
}

/**
 * Always-on keyword spotting. It is intentionally lazy: the app runs without
 * the native packages or model, and the service reports `unavailable` instead
 * of taking the pet down.
 */
export class WakeWordService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.modelsDir = options.modelsDir || path.join(defaultVoiceRoot(), MODEL_DIR_NAME);
    this.keywordsFile = options.keywordsFile || path.join(this.modelsDir, 'keywords.txt');
    this.running = false;
    this.kws = null;
    this.stream = null;
    this.mic = null;
    this.audioDevice = null;
    this.audioHost = null;
    this.resampler = null;
  }

  async start() {
    if (this.running) return true;
    const files = await findModelFiles(this.modelsDir);
    if (!files.encoder || !files.decoder || !files.joiner || !files.tokens) {
      this.emit('status', {
        state: 'unavailable',
        message: `缺少关键词模型：${this.modelsDir}`,
        hint: '运行 npm run voice:model',
      });
      return false;
    }
    try {
      await fs.access(this.keywordsFile);
    } catch {
      this.emit('status', {
        state: 'unavailable',
        message: `缺少关键词文件：${this.keywordsFile}`,
      });
      return false;
    }

    let sherpa;
    let cpal;
    try {
      sherpa = (await import('sherpa-onnx-node')).default;
      cpal = (await import('node-cpal')).default;
    } catch (error) {
      this.emit('status', {
        state: 'unavailable',
        message: '语音依赖未安装（sherpa-onnx-node / node-cpal）',
        hint: 'npm install，或只使用 Ctrl+Alt+Space 手动唤醒',
        detail: String(error?.message ?? error),
      });
      return false;
    }

    try {
      const config = {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: path.join(this.modelsDir, files.encoder),
            decoder: path.join(this.modelsDir, files.decoder),
            joiner: path.join(this.modelsDir, files.joiner),
          },
          tokens: path.join(this.modelsDir, files.tokens),
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
        keywordsFile: this.keywordsFile,
      };
      this.kws = new sherpa.KeywordSpotter(config);
      this.stream = this.kws.createStream();

      const audio = cpal.convenience;
      this.audioDevice = audio.getDefaultInputDevice();
      if (!this.audioDevice) throw new Error('没有可用的默认麦克风');
      const nativeConfig = audio.getDefaultInputConfig(this.audioDevice.deviceId);
      const nativeRate = nativeConfig.sampleRate;
      const targetRate = config.featConfig.sampleRate;
      this.resampler = new sherpa.LinearResampler(nativeRate, targetRate);

      this.mic = await audio.createInputStream({
        deviceId: this.audioDevice.deviceId,
        config: nativeConfig,
        autoStart: true,
        queueCapacityBuffers: 32,
        onData: (data) => {
          if (!this.running) return;
          try {
            const floats = toFloat(data, nativeConfig.sampleFormat);
            const samples = this.resampler.resample(downmix(floats, nativeConfig.channels));
            this.stream.acceptWaveform({ sampleRate: targetRate, samples });
            while (this.kws.isReady(this.stream)) this.kws.decode(this.stream);
            const keyword = this.kws.getResult(this.stream).keyword;
            if (keyword) this.emit('keyword', keyword);
          } catch (error) {
            this.emit('status', { state: 'error', message: '关键词识别失败', detail: String(error?.message ?? error) });
          }
        },
        onError: (error) => {
          this.emit('status', { state: 'warning', message: '麦克风缓冲异常', detail: String(error?.message ?? error) });
        },
      });
      this.running = true;
      this.emit('status', {
        state: 'listening',
        message: '关键词唤醒已启动',
        sampleRate: nativeRate,
        channels: nativeConfig.channels,
      });
      return true;
    } catch (error) {
      this.running = false;
      this.emit('status', {
        state: 'error',
        message: '关键词唤醒启动失败',
        detail: String(error?.message ?? error),
      });
      return false;
    }
  }

  stop() {
    this.running = false;
    try {
      const closing = this.mic?.close?.();
      closing?.catch?.(() => {});
    } catch {
      // The native stream may already be gone.
    }
    this.mic = null;
    this.audioDevice = null;
    this.audioHost = null;
    this.stream = null;
    this.kws = null;
    this.resampler = null;
  }
}

export { defaultVoiceRoot, MODEL_DIR_NAME };

