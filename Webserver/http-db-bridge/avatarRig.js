'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RobloxFile } = require('rbxm-parser');

const AVATAR_ASSET_DIR = path.join(__dirname, '..', '..', 'shared', 'content', 'avatar');
const SUPPORTED_RIGS = new Set(['R6', 'R15']);
const rigCache = new Map();

function vector3(value, label) {
  if (!value || ![value.X, value.Y, value.Z].every(Number.isFinite)) {
    throw new Error(`RBXM rig contains an invalid ${label}`);
  }
  return { x: value.X, y: value.Y, z: value.Z };
}

function getRigGeometry(rig) {
  const rigName = String(rig || '').toUpperCase();
  if (!SUPPORTED_RIGS.has(rigName)) {
    throw new RangeError(`Unsupported avatar rig: ${rigName || '(empty)'}`);
  }
  if (rigCache.has(rigName)) return rigCache.get(rigName);

  const filePath = path.join(AVATAR_ASSET_DIR, `${rigName}.rbxm`);
  const model = RobloxFile.ReadFromBuffer(fs.readFileSync(filePath));
  if (!model || !Array.isArray(model.Roots) || !model.Roots.length) {
    throw new Error(`Could not parse the bundled ${rigName} RBXM rig`);
  }

  const descendants = [];
  const visit = (instance) => {
    if (instance.IsA('BasePart')) descendants.push(instance);
    instance.Children.forEach(visit);
  };
  model.Roots.forEach(visit);

  const rootPart = descendants.find((part) => part.Name === 'HumanoidRootPart');
  if (!rootPart || !descendants.length) {
    throw new Error(`Bundled ${rigName} RBXM has no HumanoidRootPart or body parts`);
  }
  const origin = rootPart.CFrame.Position;

  const parts = descendants
    .filter((part) => part.Name !== 'HumanoidRootPart')
    .map((part) => {
      const position = part.CFrame.Position;
      const size = part.Size;
      const mesh = part.Children.find((child) => child.ClassName === 'SpecialMesh');
      const rotation = part.CFrame.Orientation;
      const specialMeshType = mesh && mesh.MeshType && mesh.MeshType.Name
        ? mesh.MeshType.Name : null;
      if (!Array.isArray(rotation) || rotation.length !== 9 || !rotation.every(Number.isFinite)) {
        throw new Error(`RBXM part "${part.Name}" has an invalid transform`);
      }
      if (![size.X, size.Y, size.Z].every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
        throw new Error(`RBXM part "${part.Name}" has an invalid size`);
      }
      return {
        name: part.Name,
        className: part.ClassName,
        shape: part.Shape && part.Shape.Name ? part.Shape.Name : null,
        meshGeometryIncluded: part.ClassName !== 'MeshPart' && !specialMeshType,
        size: vector3(size, `size for ${part.Name}`),
        position: {
          x: position.X - origin.X,
          y: position.Y - origin.Y,
          z: position.Z - origin.Z,
        },
        rotation,
        mesh: mesh ? {
          type: mesh.MeshType && mesh.MeshType.Name ? mesh.MeshType.Name : 'FileMesh',
          scale: vector3(mesh.Scale, `mesh scale for ${part.Name}`),
          offset: vector3(mesh.Offset, `mesh offset for ${part.Name}`),
        } : null,
        meshId: part.ClassName === 'MeshPart' ? String(part.MeshId || '') : null,
        textureId: part.ClassName === 'MeshPart' ? String(part.TextureID || '') : null,
      };
    });

  if (!parts.length) throw new Error(`Bundled ${rigName} RBXM contains no visible body parts`);
  const geometry = { rig: rigName, parts };
  rigCache.set(rigName, geometry);
  return geometry;
}

module.exports = { getRigGeometry };
