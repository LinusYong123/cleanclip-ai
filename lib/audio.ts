/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseVideoUrl, type VideoInfo } from "./platforms";
import { fetchBuf } from "./frames";

export interface AudioFingerprint {
  id: string;
  loudness: number;
  waveform: Float64Array;
  normalizedSignature: string;
  duration: number;
  frequencyProfile: number[];
  tempogram: number[];
}

export interface AudioSignature {
  id: string;
  duration: number;
  loudness: number;
  waveformHash: string;
  frequencySignature: string;
  normalizedSignature: string;
}

export class AudioProcessor {
  async extractAudioFingerprint(url: string, videoInfo?: VideoInfo | null): Promise<AudioFingerprint | null> {
    try {
      const vid = parseVideoUrl(url);
      if (!vid) return null;

      const audio = await this.extractAudio(url, vid, videoInfo);
      const sig = await this.createSignature(audio);

      return {
        id: crypto.randomUUID(),
        loudness: audio.loudness,
        waveform: audio.waveform,
        normalizedSignature: sig.normalizedSignature,
        duration: audio.duration,
        frequencyProfile: audio.frequencyProfile,
        tempogram: audio.tempogram,
      };
    } catch (error) {
      console.error("Audio fingerprint extraction failed:", error);
      return null;
    }
  }

  async compareAudio(audio1: AudioSignature, audio2: AudioSignature): Promise<number> {
    return 1 - hamming(audio1.waveformHash, audio2.waveformHash);
  }

  async extractAudio(url: string, vid: { platform: string; id: string }, videoInfo?: VideoInfo | null): Promise<any> {
    const audioConfig = this.getAudioConfig(vid.platform);
    const duration = videoInfo?.duration || 30;

    let audioUrl = url;
    if (vid.platform === "youtube") {
      audioUrl = `https://www.youtube.com/watch?v=${vid.id}&action_get_audio_url=1`;
    }

    try {
      const buf = await this.fetchAudioSegment(audioUrl, duration, audioConfig);
      return this.analyzeAudio(buf, duration, audioConfig);
    } catch (error) {
      console.error("Audio extraction failed:", error);
      throw error;
    }
  }

  getAudioConfig(platform: string): any {
    const defaultConfig = {
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      normalization: 0.95,
    };

    const platformConfigs = {
      "youtube": { sampleRate: 48000, channels: 2, bitDepth: 16, normalization: 0.9 },
      "tiktok": { sampleRate: 48000, channels: 1, bitDepth: 16, normalization: 0.95 },
      "vimeo": { sampleRate: 44100, channels: 2, bitDepth: 16, normalization: 0.9 },
      "instagram": { sampleRate: 44100, channels: 1, bitDepth: 16, normalization: 0.95 },
      "facebook": { sampleRate: 44100, channels: 2, bitDepth: 16, normalization: 0.95 },
    };

    return platformConfigs[platform as keyof typeof platformConfigs] || defaultConfig;
  }

  async fetchAudioSegment(url: string, duration: number, config: any): Promise<Buffer> {
    const startTime = 0;
    const format = config.channels === 1 ? "pcm_u8" : "wav";

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}" 2>/dev/null || echo "0"`;
      exec(command, async (err: any, stdout: any) => {
        const totalDuration = parseFloat(stdout) || duration;
        const start = Math.min(startTime, totalDuration - 5);
        const segmentDuration = Math.min(duration, totalDuration - start);

        if (segmentDuration <= 0) {
          reject(new Error("Invalid audio segment duration"));
          return;
        }

        const audioCmd = `ffmpeg -i "${url}" -ss ${start} -t ${segmentDuration} -vn -ac ${config.channels} -ar ${config.sampleRate} -y -f ${format} -`;

        const ff = spawn(audioCmd, { shell: true }, (err: any, stdout: any, stderr: any) => {
          if (err) {
            reject(new Error(`Audio extraction failed: ${stderr}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });

        ff.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        ff.stderr.on("data", (chunk: Buffer) => {});
      });
    });
  }

  analyzeAudio(audioBuffer: Buffer, duration: number, config: any): any {
    const samples = this.decodeAudioBuffer(audioBuffer, config);
    const loudness = this.calculateLoudness(samples);
    const waveform = this.extractWaveform(samples);
    const frequencyProfile = this.calculateFrequencyProfile(samples, config.sampleRate);
    const tempogram = this.calculateTempogram(samples);

    return {
      duration,
      loudness,
      waveform,
      frequencyProfile,
      tempogram,
    };
  }

  decodeAudioBuffer(buffer: Buffer, config: any): Float64Array {
    switch (config.bitDepth) {
      case 16:
        return this.decodePCM16(buffer, config.channels, config.sampleRate);
      case 8:
        return this.decodePCM8(buffer, config.channels, config.sampleRate);
      case 24:
        return this.decodePCM24(buffer, config.channels, config.sampleRate);
      default:
        return this.decodePCM16(buffer, config.channels, config.sampleRate);
    }
  }

  decodePCM16(buffer: Buffer, channels: number, sampleRate: number): Float64Array {
    const samples = new Float64Array(Math.floor(buffer.length / (2 * channels)));
    let offset = 0;

    for (let i = 0; i < samples.length; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const sample = buffer.readInt16LE(offset);
        sum += sample / 32768;
        offset += 2;
      }
      samples[i] = sum / channels;
    }

    return samples;
  }

  calculateLoudness(samples: Float64Array): number {
    const mean = this.mean(samples);
    const variance = this.variance(samples, mean);
    const rms = Math.sqrt(variance);
    return 20 * Math.log10(rms > 0 ? rms : 0.00001);
  }

  extractWaveform(samples: Float64Array, windowSize: number = 1024): Float64Array {
    const waveform = new Float64Array(Math.ceil(samples.length / windowSize));
    for (let i = 0; i < waveform.length; i++) {
      const start = i * windowSize;
      const end = Math.min(start + windowSize, samples.length);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += samples[j];
      }
      waveform[i] = sum / (end - start);
    }
    return waveform;
  }

  calculateFrequencyProfile(samples: Float64Array, sampleRate: number): number[] {
    const fftSize = 1024;
    const frequencyBins = Math.floor(samples.length / fftSize);
    const frequencyProfile = new Array(frequencyBins).fill(0);

    for (let bin = 0; bin < frequencyBins; bin++) {
      const start = bin * fftSize;
      const end = Math.min(start + fftSize, samples.length);
      const binSamples = samples.slice(start, end);
      const magnitude = this.calculateMagnitude(binSamples);
      frequencyProfile[bin] = magnitude;
    }

    return frequencyProfile;
  }

  calculateTempogram(samples: Float64Array): number[] {
    const tempogram = new Array(10).fill(0);
    const windowSize = Math.floor(samples.length / 10);

    for (let i = 0; i < 10; i++) {
      const start = i * windowSize;
      const end = Math.min(start + windowSize, samples.length);
      const window = samples.slice(start, end);
      tempogram[i] = this.calculateEnergy(window);
    }

    return tempogram;
  }

  calculateMagnitude(samples: Float64Array): number {
    const mean = this.mean(samples);
    const variance = this.variance(samples, mean);
    return Math.sqrt(variance);
  }

  calculateEnergy(samples: Float64Array): number {
    let sum = 0;
    for (const sample of samples) {
      sum += sample * sample;
    }
    return sum / samples.length;
  }

  mean(samples: Float64Array): number {
    let sum = 0;
    for (const sample of samples) {
      sum += sample;
    }
    return sum / samples.length;
  }

  variance(samples: Float64Array, mean: number): number {
    let sum = 0;
    for (const sample of samples) {
      sum += Math.pow(sample - mean, 2);
    }
    return sum / samples.length;
  }

  async createSignature(audioData: any): Promise<AudioSignature> {
    const waveformHash = this.generateHash(audioData.waveform);
    const frequencySignature = this.generateFrequencyHash(audioData.frequencyProfile);
    const normalizedSignature = this.normalizeSignature(waveformHash, frequencySignature);

    return {
      id: crypto.randomUUID(),
      duration: audioData.duration,
      loudness: audioData.loudness,
      waveformHash,
      frequencySignature,
      normalizedSignature,
    };
  }

  generateHash(waveform: Float64Array): string {
    const hash = new Uint32Array(10);
    for (let i = 0; i < 10 && i < waveform.length; i++) {
      hash[i] = Math.floor((waveform[i] + 1) * 1000000) % 4294967296;
    }
    return this.uint32ArrayToHex(hash);
  }

  generateFrequencyHash(frequencyProfile: number[]): string {
    const hash = new Uint32Array(frequencyProfile.length);
    for (let i = 0; i < frequencyProfile.length; i++) {
      hash[i] = Math.floor(frequencyProfile[i] * 1000) % 4294967296;
    }
    return this.uint32ArrayToHex(hash);
  }

  normalizeSignature(waveformHash: string, frequencySignature: string): string {
    const combined = waveformHash + frequencySignature;
    const encoder = new TextEncoder();
    const data = encoder.encode(combined);
    const hash = crypto.createHash("sha256").update(data).digest();
    return this.arrayBufferToHex(hash);
  }

  uint32ArrayToHex(arr: Uint32Array): string {
    let hex = "";
    for (let i = 0; i < arr.length; i++) {
      hex += arr[i].toString(16).padStart(8, "0");
    }
    return hex;
  }

  arrayBufferToHex(buffer: ArrayBuffer): string {
    const hexArray = Array.from(new Uint8Array(buffer));
    return hexArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

const exec = (command: string, callback: any) => {
  const { exec } = require("child_process");
  exec(command, callback);
};

const spawn = (command: string, options: any, callback: any) => {
  const { spawn } = require("child_process");
  return spawn(command, { shell: true, ...options }, callback);
};