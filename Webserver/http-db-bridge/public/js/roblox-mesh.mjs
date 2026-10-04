const MAX_VERTICES = 1_000_000;
const MAX_FACES = 2_000_000;

function parseRobloxMesh(source) {
  const bytes = source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const header = new TextDecoder().decode(bytes.subarray(0, 12)).trim();
  const versionMatch = /^version ([123])\.00$/.exec(header);
  if (!versionMatch) {
    throw new Error(`Unsupported Roblox mesh format: ${header || 'empty file'}`);
  }
  if (Number(versionMatch[1]) === 1) return parseVersionOneMesh(bytes);
  if (bytes.byteLength < 25) throw new Error('Roblox mesh header is truncated.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerOffset = 13;
  const headerSize = view.getUint16(headerOffset, true);
  const vertexSize = view.getUint8(headerOffset + 2);
  const faceSize = view.getUint8(headerOffset + 3);
  let vertexCount;
  let faceCount;
  let lodCount = 0;
  let lodSize = 0;

  if (headerSize > 12) {
    lodSize = view.getUint16(headerOffset + 4, true);
    lodCount = view.getUint16(headerOffset + 6, true);
    vertexCount = view.getUint16(headerOffset + 8, true);
    faceCount = view.getUint16(headerOffset + 12, true);
  } else {
    vertexCount = view.getUint32(headerOffset + 4, true);
    faceCount = view.getUint32(headerOffset + 8, true);
  }

  if (headerSize < 12 || vertexSize < 32 || faceSize < 12
    || vertexCount < 1 || vertexCount > MAX_VERTICES
    || faceCount < 1 || faceCount > MAX_FACES) {
    throw new Error('Roblox mesh has invalid geometry counts or record sizes.');
  }

  const vertexStart = headerOffset + headerSize;
  const faceStart = vertexStart + vertexCount * vertexSize;
  const lodStart = faceStart + faceCount * faceSize;
  const requiredBytes = lodStart + lodCount * lodSize;
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes > bytes.byteLength) {
    throw new Error('Roblox mesh geometry is truncated.');
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = vertexStart + index * vertexSize;
    const vectorOffset = index * 3;
    const uvOffset = index * 2;
    positions[vectorOffset] = view.getFloat32(offset, true);
    positions[vectorOffset + 1] = view.getFloat32(offset + 4, true);
    positions[vectorOffset + 2] = view.getFloat32(offset + 8, true);
    normals[vectorOffset] = view.getFloat32(offset + 12, true);
    normals[vectorOffset + 1] = view.getFloat32(offset + 16, true);
    normals[vectorOffset + 2] = view.getFloat32(offset + 20, true);
    uvs[uvOffset] = view.getFloat32(offset + 24, true);
    uvs[uvOffset + 1] = 1 - view.getFloat32(offset + 28, true);
    if (![...positions.subarray(vectorOffset, vectorOffset + 3),
      ...normals.subarray(vectorOffset, vectorOffset + 3),
      ...uvs.subarray(uvOffset, uvOffset + 2)].every(Number.isFinite)) {
      throw new Error(`Roblox mesh vertex ${index} contains non-finite data.`);
    }
  }

  const indices = new Uint32Array(faceCount * 3);
  for (let face = 0; face < faceCount; face += 1) {
    const offset = faceStart + face * faceSize;
    const outputOffset = face * 3;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = view.getUint32(offset + corner * 4, true);
      if (vertex >= vertexCount) throw new Error(`Roblox mesh face ${face} references a missing vertex.`);
      indices[outputOffset + corner] = vertex;
    }
  }

  return {
    version: Number(versionMatch[1]),
    positions,
    normals,
    uvs,
    indices,
  };
}

function parseVersionOneMesh(bytes) {
  const source = new TextDecoder().decode(bytes);
  const header = /^version 1\.00\r?\n(\d+)\r?\n([\s\S]*)$/.exec(source);
  if (!header) throw new Error('Roblox mesh v1 header is invalid.');

  const faceCount = Number(header[1]);
  if (!Number.isSafeInteger(faceCount) || faceCount < 1 || faceCount > MAX_FACES) {
    throw new Error('Roblox mesh v1 has an invalid face count.');
  }

  const body = header[2];
  const vectors = Array.from(body.matchAll(/\[([^\]]*)\]/g));
  if (vectors.length !== faceCount * 9 || body.replace(/\[[^\]]*\]/g, '').trim() !== '') {
    throw new Error('Roblox mesh v1 has an invalid vertex or face table.');
  }

  const vertexCount = faceCount * 3;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(vertexCount);

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const position = parseVector(vectors[vertex * 3][1], 'position');
    const normal = parseVector(vectors[vertex * 3 + 1][1], 'normal');
    const uv = parseVector(vectors[vertex * 3 + 2][1], 'UV');
    positions.set(position, vertex * 3);
    normals.set(normal, vertex * 3);
    uvs.set(uv.slice(0, 2), vertex * 2);
    indices[vertex] = vertex;
  }

  return { version: 1, positions, normals, uvs, indices };
}

function parseVector(value, label) {
  const components = value.split(',').map((component) => Number(component.trim()));
  if (components.length !== 3 || !components.every(Number.isFinite)) {
    throw new Error(`Roblox mesh v1 contains an invalid ${label} vector.`);
  }
  return components;
}

export { parseRobloxMesh };
