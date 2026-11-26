type Bytes = Uint8Array<ArrayBuffer>;
type VP9Frames = Map<number, Bytes>;
const text = new TextEncoder();

function join(parts: readonly Bytes[]): Bytes {
  const combined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { combined.set(part, offset); offset += part.length; }
  return combined;
}

function uint(value: number, min = 1): Bytes {
  const width = Math.max(min, Math.ceil(Math.log2(value + 1) / 8));
  const result = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) { result[i] = value % 256; value = Math.floor(value / 256); }
  return result;
}

function element(id: number, ...parts: Bytes[]): Bytes {
  const bytes = join(parts);
  let width = 1;
  while (bytes.length >= 2 ** (width * 7) - 1) width++;
  return join([uint(id), uint(bytes.length + 2 ** (width * 7), width), bytes]);
}

function number(id: number, value: number) { return element(id, uint(value)); }
function string(id: number, value: string) { return element(id, text.encode(value)); }

// Each short clip is all-keyframe. Its monochrome VP9 frame is stored in BlockAdditional 1.
function mux(color: VP9Frames, alpha: VP9Frames, width: number, height: number, fps: number, count: number) {
  if (color.size !== count || alpha.size !== count) throw Error('透明視訊編碼未產生全部影格。');
  const header = element(0x1a45dfa3, number(0x4286, 1), number(0x42f7, 1), number(0x42f2, 4), number(0x42f3, 8),
    string(0x4282, 'webm'), number(0x4287, 4), number(0x4285, 2));
  const duration = new Uint8Array(8);
  new DataView(duration.buffer).setFloat64(0, count * 1000 / fps);
  const info = element(0x1549a966, number(0x2ad7b1, 1_000_000), element(0x4489, duration), string(0x4d80, 'Moon Teahouse'), string(0x5741, 'Moon Teahouse'));
  const tracks = element(0x1654ae6b, element(0xae, number(0xd7, 1), number(0x73c5, 1), number(0x83, 1), number(0x9c, 0),
    number(0x23e383, Math.round(1e9 / fps)), number(0x55ee, 1), string(0x86, 'V_VP9'),
    element(0xe0, number(0xb0, width), number(0xba, height), number(0x53c0, 1))));
  function seekHead(offset: number) {
    return element(0x114d9b74, element(0x4dbb, element(0x53ab, uint(0x1c53bb6b)), element(0x53ac, uint(offset, 4))));
  }
  let offset = seekHead(0).length + info.length + tracks.length;
  const clusters: Bytes[] = [];
  const points: Bytes[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = Math.round(i * 1e6 / fps);
    const time = Math.round(i * 1000 / fps);
    const frame = color.get(timestamp), mask = alpha.get(timestamp);
    if (!frame || !mask) throw Error('色彩影格與透明影格不同步。');
    const head = Uint8Array.of(0x81, 0, 0, 0);
    const group = element(0xa0, element(0xa1, head, frame),
      element(0x75a1, element(0xa6, number(0xee, 1), element(0xa5, mask))));
    const cluster = element(0x1f43b675, number(0xe7, time), group);
    points.push(element(0xbb, number(0xb3, time), element(0xb7, number(0xf7, 1), number(0xf1, offset))));
    clusters.push(cluster);
    offset += cluster.length;
  }
  const cues = element(0x1c53bb6b, ...points);
  return join([header, element(0x18538067, seekHead(offset), info, tracks, ...clusters, cues)]);
}

export async function encodeTransparentWebM(canvas: HTMLCanvasElement, fps: number, count: number, paint: (index: number) => void, signal?: AbortSignal) {
  const width = canvas.width, height = canvas.height;
  if (width % 2 || height % 2) throw Error('透明影片畫布的寬高必須為偶數。');
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const color: VP9Frames = new Map();
  const alpha: VP9Frames = new Map();
  let failure: DOMException | undefined;
  const configure = (frames: VP9Frames, bitrate: number) => {
    const encoder = new VideoEncoder({
      output: chunk => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        frames.set(chunk.timestamp, data);
      },
      error: error => { failure = error; },
    });
    encoder.configure({ codec: 'vp09.00.30.08', width, height, bitrate, framerate: fps, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' });
    return encoder;
  };
  let colorEncoder: VideoEncoder | undefined;
  let alphaEncoder: VideoEncoder | undefined;
  const area = width * height;
  const mask = new Uint8Array(area * 3 / 2);
  mask.fill(128, area);
  try {
    colorEncoder = configure(color, 1_800_000);
    alphaEncoder = configure(alpha, 540_000);
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      if (failure) throw failure;
      paint(i);
      const timestamp = Math.round(i * 1e6 / fps);
      const duration = Math.round((i + 1) * 1e6 / fps) - timestamp;
      const rgba = context.getImageData(0, 0, width, height).data;
      for (let pixel = 0; pixel < area; pixel++) mask[pixel] = rgba[pixel * 4 + 3];
      const picture = new VideoFrame(rgba, { format: 'RGBX', codedWidth: width, codedHeight: height, timestamp, duration });
      const transparency = new VideoFrame(mask, { format: 'I420', codedWidth: width, codedHeight: height, timestamp, duration,
        colorSpace: { fullRange: true, primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' } });
      try { colorEncoder.encode(picture, { keyFrame: true }); alphaEncoder.encode(transparency, { keyFrame: true }); }
      finally { picture.close(); transparency.close(); }
    }
    await Promise.all([colorEncoder.flush(), alphaEncoder.flush()]);
    if (failure) throw failure;
    signal?.throwIfAborted();
    return mux(color, alpha, width, height, fps, count);
  } finally {
    if (colorEncoder && colorEncoder.state !== 'closed') colorEncoder.close();
    if (alphaEncoder && alphaEncoder.state !== 'closed') alphaEncoder.close();
  }
}
