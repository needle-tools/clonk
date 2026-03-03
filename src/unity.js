/**
 * Unity .resource file audio extractor.
 *
 * Unity stores audio as concatenated FSB5 (FMOD Sound Bank) entries inside
 * `.resource` / `.resS` files.  This module splits those files into
 * individual WAV files without any external tools.
 *
 * Supported FSB5 codecs:
 *   - PCM16 (codec 2) — decoded directly to WAV
 *   - Vorbis (codec 15) — written as raw .fsb for vgmstream
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { open } from "node:fs/promises";
import { join, basename, extname } from "node:path";

const FSB5_MAGIC = 0x35425346; // "FSB5" little-endian

/**
 * Scan a buffer for all FSB5 bank offsets.
 */
function findFSB5Offsets(buf) {
  const offsets = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf.readUInt32LE(i) === FSB5_MAGIC) {
      offsets.push(i);
    }
  }
  return offsets;
}

/**
 * Parse an FSB5 header at a given offset in a buffer.
 * Returns { version, numSamples, sampleHeaderSize, nameTableSize, dataSize, mode, headerSize, totalSize }
 */
function parseFSB5Header(buf, offset) {
  const version = buf.readUInt32LE(offset + 4);
  const numSamples = buf.readUInt32LE(offset + 8);
  const sampleHeaderSize = buf.readUInt32LE(offset + 12);
  const nameTableSize = buf.readUInt32LE(offset + 16);
  const dataSize = buf.readUInt32LE(offset + 20);
  const mode = buf.readUInt32LE(offset + 24);
  // FSB5 base header is 60 bytes (version 1) or 64 bytes (version 0)
  const headerSize = version === 1 ? 60 : 64;
  const totalSize = headerSize + sampleHeaderSize + nameTableSize + dataSize;
  return { version, numSamples, sampleHeaderSize, nameTableSize, dataSize, mode, headerSize, totalSize };
}

/**
 * Parse FSB5 sample metadata (frequency, channels, data offset, data length).
 * Each sample header entry is an 8-byte packed value.
 */
function parseFSB5Samples(buf, bankOffset, header) {
  const samples = [];
  let pos = bankOffset + header.headerSize;
  const dataStart = bankOffset + header.headerSize + header.sampleHeaderSize + header.nameTableSize;

  for (let i = 0; i < header.numSamples; i++) {
    // Sample header: first 8 bytes contain packed metadata
    // Bits 0:      hasNextChunk
    // Bits 1-3:    frequency index
    // Bits 5-6:    channels - 1
    // Bits 7-33:   dataOffset (relative to data section start, in units of 32 bytes)
    // Bits 34-63:  numSamples (sample count / length)
    const lo = buf.readUInt32LE(pos);
    const hi = buf.readUInt32LE(pos + 4);

    const freqIndex = (lo >> 1) & 0xf;
    const freqTable = [8000, 11000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
    const frequency = freqTable[freqIndex] || 44100;

    const channels = ((lo >> 5) & 0x3) + 1;

    // dataOffset in 32-byte granularity
    const dataOffsetRaw = ((lo >>> 7) | ((hi & 0x3) << 25));
    const dataOffset = dataOffsetRaw * 32;

    const sampleCount = (hi >>> 2);

    // Determine data length: distance to next sample's offset, or remaining data
    let dataLength;
    if (i + 1 < header.numSamples) {
      // Peek next sample's offset
      const nextLo = buf.readUInt32LE(pos + 8);
      const nextHi = buf.readUInt32LE(pos + 12);
      const nextDataOffset = (((nextLo >>> 7) | ((nextHi & 0x3) << 25))) * 32;
      dataLength = nextDataOffset - dataOffset;
    } else {
      dataLength = header.dataSize - dataOffset;
    }

    // Skip extra metadata chunks if hasNextChunk bit is set
    let samplePos = pos + 8;
    let hasNext = lo & 1;
    while (hasNext) {
      const chunkInfo = buf.readUInt32LE(samplePos);
      hasNext = chunkInfo & 1;
      const chunkSize = (chunkInfo >>> 1) & 0xffffff;
      samplePos += 4 + chunkSize;
    }

    samples.push({
      frequency,
      channels,
      dataOffset: dataStart + dataOffset,
      dataLength,
      sampleCount,
    });

    pos = samplePos;
  }

  return samples;
}

/**
 * Create a WAV file buffer from raw PCM16 data.
 */
function createWav(pcmData, sampleRate, channels) {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const headerSize = 44;

  const wav = Buffer.alloc(headerSize + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(headerSize + dataSize - 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20);  // PCM format
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmData.copy(wav, 44);

  return wav;
}

/**
 * Extract audio from a Unity .resource file.
 *
 * @param {string} resourcePath - Path to the .resource / .resS file
 * @param {string} outputDir - Directory to write extracted files
 * @returns {Promise<Array<{path: string, name: string, codec: string}>>}
 */
export async function extractUnityResource(resourcePath, outputDir) {
  const buf = await readFile(resourcePath);
  const offsets = findFSB5Offsets(buf);
  if (offsets.length === 0) return [];

  await mkdir(outputDir, { recursive: true });

  const baseName = basename(resourcePath, extname(resourcePath));
  const results = [];

  for (let i = 0; i < offsets.length; i++) {
    const header = parseFSB5Header(buf, offsets[i]);
    if (header.numSamples === 0) continue;

    const samples = parseFSB5Samples(buf, offsets[i], header);

    for (let s = 0; s < samples.length; s++) {
      const sample = samples[s];
      const sampleIdx = results.length;
      const codecName = header.mode === 2 ? "pcm16" : header.mode === 15 ? "vorbis" : `codec${header.mode}`;

      if (header.mode === 2) {
        // PCM16 — extract directly to WAV
        const pcmData = buf.slice(sample.dataOffset, sample.dataOffset + sample.dataLength);
        const wav = createWav(pcmData, sample.frequency, sample.channels);
        const outName = `${baseName}_${String(sampleIdx).padStart(3, "0")}.wav`;
        const outPath = join(outputDir, outName);
        await writeFile(outPath, wav);
        results.push({ path: outPath, name: outName, codec: codecName });
      } else {
        // Non-PCM (Vorbis etc.) — write raw FSB5 bank for vgmstream
        const fsbData = buf.slice(offsets[i], offsets[i] + header.totalSize);
        const outName = `${baseName}_${String(sampleIdx).padStart(3, "0")}.fsb`;
        const outPath = join(outputDir, outName);
        await writeFile(outPath, fsbData);
        results.push({ path: outPath, name: outName, codec: codecName });
      }
    }
  }

  return results;
}

/**
 * Check if a file is a Unity resource with FSB5 audio.
 * Reads only the first 4 bytes.
 */
export async function isUnityAudioResource(filePath) {
  try {
    const fh = await open(filePath, "r");
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    await fh.close();
    return buf.readUInt32LE(0) === FSB5_MAGIC;
  } catch {
    return false;
  }
}

/**
 * Find Unity .resource files containing audio in a game directory.
 */
export async function findUnityAudioResources(gameDir, maxDepth = 5) {
  const results = [];

  async function scan(dir, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase();
          if (["__pycache__", "node_modules", ".git"].some((s) => lower.includes(s))) continue;
          await scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (ext === ".resource" || ext === ".ress") {
            if (await isUnityAudioResource(fullPath)) {
              results.push(fullPath);
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  await scan(gameDir, 0);
  return results;
}
