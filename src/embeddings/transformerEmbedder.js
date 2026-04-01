import { pipeline } from "@xenova/transformers";
import { env } from "../config/env.js";

let extractor;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", env.embeddingModel);
  }
  return extractor;
}

function l2Normalize(vec) {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function meanPool(tensor) {
  const dims = tensor.dims;
  const data = Array.from(tensor.data);

  const seqLen = dims[dims.length - 2];
  const hidden = dims[dims.length - 1];

  const out = new Array(hidden).fill(0);
  for (let i = 0; i < seqLen; i += 1) {
    for (let j = 0; j < hidden; j += 1) {
      out[j] += data[i * hidden + j];
    }
  }
  for (let j = 0; j < hidden; j += 1) {
    out[j] /= seqLen;
  }

  return l2Normalize(out);
}

export async function embedText(text) {
  const fx = await getExtractor();
  const output = await fx(text, { pooling: "none", normalize: false });
  return meanPool(output);
}
