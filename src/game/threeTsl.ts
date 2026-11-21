import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  float,
  fract,
  length,
  max,
  min,
  mix,
  positionWorld,
  sin,
  smoothstep,
  sRGBTransferOETF,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

export interface RadialFanMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  uInnerRadius: THREE.UniformNode<'float', number>;
  uRange: THREE.UniformNode<'float', number>;
  uStopPos: THREE.UniformNode<'float', number>;
  uColor0: THREE.UniformNode<'color', THREE.Color>;
  uColor1: THREE.UniformNode<'color', THREE.Color>;
  uColor2: THREE.UniformNode<'color', THREE.Color>;
  uAlpha0: THREE.UniformNode<'float', number>;
  uAlpha1: THREE.UniformNode<'float', number>;
  uAlpha2: THREE.UniformNode<'float', number>;
}

export function createBatchedRadialFanMaterial(): THREE.MeshBasicNodeMaterial {
  const radialOffset = attribute('aRadialOffset', 'vec2');
  const params = attribute('aFanParams', 'vec3');
  const c0 = attribute('aColor0', 'vec4');
  const c1 = attribute('aColor1', 'vec4');
  const c2 = attribute('aColor2', 'vec4');

  const innerRadius = params.x;
  const range = params.y;
  const stopPos = params.z;

  const dist = length(radialOffset);
  const denom = max(range.sub(innerRadius), float(0.001));
  const t = clamp(dist.sub(innerRadius).div(denom), float(0.0), float(1.0));

  const stopSafe = clamp(stopPos, float(0.01), float(0.99));
  const tLow = clamp(t.div(stopSafe), float(0.0), float(1.0));
  const tHigh = clamp(t.sub(stopSafe).div(float(1.0).sub(stopSafe)), float(0.0), float(1.0));
  const inHigh = step(stopSafe, t);

  const col = mix(mix(c0.rgb, c1.rgb, tLow), mix(c1.rgb, c2.rgb, tHigh), inHigh);
  const alpha = mix(mix(c0.w, c1.w, tLow), mix(c1.w, c2.w, tHigh), inHigh);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = col;
  material.opacityNode = alpha;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.NormalBlending;

  return material;
}

export function createRadialFanMaterial(initialColor = 0xffffff): RadialFanMaterialBundle {
  const uInnerRadius = uniform(6.0);
  const uRange = uniform(300.0);
  const uStopPos = uniform(0.55);
  const uColor0 = uniform(new THREE.Color(initialColor));
  const uColor1 = uniform(new THREE.Color(initialColor));
  const uColor2 = uniform(new THREE.Color(initialColor));
  const uAlpha0 = uniform(1.0);
  const uAlpha1 = uniform(0.5);
  const uAlpha2 = uniform(0.0);

  const radialOffset = attribute('aRadialOffset', 'vec2');
  const dist = length(radialOffset);
  const denom = max(uRange.sub(uInnerRadius), float(0.001));
  const t = clamp(dist.sub(uInnerRadius).div(denom), float(0.0), float(1.0));

  const stopSafe = clamp(uStopPos, float(0.01), float(0.99));
  const tLow = clamp(t.div(stopSafe), float(0.0), float(1.0));
  const tHigh = clamp(t.sub(stopSafe).div(float(1.0).sub(stopSafe)), float(0.0), float(1.0));
  const inHigh = step(stopSafe, t);

  const col = mix(mix(uColor0, uColor1, tLow), mix(uColor1, uColor2, tHigh), inHigh);
  const alpha = mix(mix(uAlpha0, uAlpha1, tLow), mix(uAlpha1, uAlpha2, tHigh), inHigh);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = col;
  material.opacityNode = alpha;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.NormalBlending;

  return {
    material,
    uInnerRadius,
    uRange,
    uStopPos,
    uColor0,
    uColor1,
    uColor2,
    uAlpha0,
    uAlpha1,
    uAlpha2,
  };
}

export interface OceanMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  uTime: THREE.UniformNode<'float', number>;
}

export function createOceanMaterial(): OceanMaterialBundle {
  const uTime = uniform(0.0);

  // Convert Three.js world coordinates (wx, -wy) back to 2D world pixels
  const wx = positionWorld.x;
  const wy = positionWorld.y.negate();

  // Layered North Atlantic swells approximating 140x76 wave crests over pure black
  const cellX = fract(wx.div(140.0));
  const cellY = fract(wy.div(76.0));
  const phase = wy.mul(0.024).add(wx.mul(0.011));
  const drift = sin(uTime.mul(1.15).add(phase)).mul(0.11);

  const uWave1 = cellX.sub(drift);
  const bandMask1 = step(float(0.08), uWave1).mul(step(uWave1, float(0.62)));
  const curveY1 = float(0.5).sub(sin(clamp((uWave1.sub(0.08)).div(0.54), float(0.0), float(1.0)).mul(3.14159)).mul(0.09));
  const line1 = float(1.0).sub(smoothstep(float(0.0), float(0.032), abs(cellY.sub(curveY1))));
  const swell1 = line1.mul(bandMask1);

  const uWave2 = cellX.add(drift.mul(0.6));
  const bandMask2 = step(float(0.22), uWave2).mul(step(uWave2, float(0.84)));
  const curveY2 = float(0.84).sub(sin(clamp((uWave2.sub(0.22)).div(0.62), float(0.0), float(1.0)).mul(3.14159)).mul(0.06));
  const line2 = float(1.0).sub(smoothstep(float(0.0), float(0.028), abs(cellY.sub(curveY2))));
  const swell2 = line2.mul(bandMask2);

  // sRGB-matched ocean wave colors converted to linear for working color space
  const waveCol1 = vec3(0.013, 0.040, 0.107).mul(swell1.mul(0.45));
  const waveCol2 = vec3(0.040, 0.508, 0.938).mul(swell2.mul(0.14));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = waveCol1.add(waveCol2);
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;

  return { material, uTime };
}

export interface CompositeMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  sceneTexNode: ReturnType<typeof texture>;
  losTexNode: ReturnType<typeof texture>;
  lightTexNode: ReturnType<typeof texture>;
}

export function createDarknessCompositeMaterial(
  sceneTex: THREE.Texture,
  losTex: THREE.Texture,
  lightTex: THREE.Texture
): CompositeMaterialBundle {
  const sceneTexNode = texture(sceneTex);
  const losTexNode = texture(losTex);
  const lightTexNode = texture(lightTex);

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const sceneCol = sceneTexNode.sample(rtUV).rgb;
  const losVal = losTexNode.sample(rtUV).r;
  const lightVal = lightTexNode.sample(rtUV).r;

  // Strict OLED pure #000000 outside Player LoS or unlit areas
  const visibility = clamp(losVal.mul(lightVal), float(0.0), float(1.0));
  const litColor = sceneCol.mul(visibility);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = litColor;
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;

  return {
    material,
    sceneTexNode,
    losTexNode,
    lightTexNode,
  };
}

export interface VignetteDangerMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  losTexNode: ReturnType<typeof texture>;
  uResolution: THREE.UniformNode<'vec2', THREE.Vector2>;
  uSteamFog: THREE.UniformNode<'float', number>;
  uRedBoost: THREE.UniformNode<'float', number>;
  uSpotFlash: THREE.UniformNode<'float', number>;
}

export function createVignetteAndDangerMaterial(
  losTex: THREE.Texture
): VignetteDangerMaterialBundle {
  const losTexNode = texture(losTex);
  const uResolution = uniform(new THREE.Vector2(1440, 900));
  const uSteamFog = uniform(0.0);
  const uRedBoost = uniform(0.0);
  const uSpotFlash = uniform(0.0);

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const losVal = losTexNode.sample(rtUV).r;

  const pxDelta = rtUV.sub(vec2(0.5, 0.5)).mul(uResolution);
  const pxDist = length(pxDelta);
  const minDim = min(uResolution.x, uResolution.y);
  const maxDim = max(uResolution.x, uResolution.y);

  // 1. Pure black edge vignette (0.34*minDim -> 0.74*maxDim : 0 -> 0.82)
  const vigR0 = minDim.mul(0.34);
  const vigR1 = max(maxDim.mul(0.74), vigR0.add(1.0));
  const vigT = clamp(pxDist.sub(vigR0).div(vigR1.sub(vigR0)), float(0.0), float(1.0));
  const vAlpha = vigT.mul(0.82);

  // 2. LoS-clipped Steam Condensation Fog
  const stmR0 = minDim.mul(0.06);
  const stmR1 = max(maxDim.mul(0.72), stmR0.add(1.0));
  const stmT = clamp(pxDist.sub(stmR0).div(stmR1.sub(stmR0)), float(0.0), float(1.0));
  const stmLow = clamp(stmT.div(0.55), float(0.0), float(1.0));
  const stmHigh = clamp(stmT.sub(0.55).div(0.45), float(0.0), float(1.0));
  const stmStep = step(float(0.55), stmT);
  const steamCol = mix(
    mix(vec3(0.76, 0.82, 0.88), vec3(0.60, 0.67, 0.75), stmLow),
    mix(vec3(0.60, 0.67, 0.75), vec3(0.30, 0.37, 0.48), stmHigh),
    stmStep
  );
  const aSteam = clamp(
    mix(mix(float(0.56), float(0.68), stmLow), mix(float(0.68), float(0.74), stmHigh), stmStep)
      .mul(uSteamFog)
      .mul(losVal),
    float(0.0),
    float(1.0)
  );

  // 3. LoS-clipped Brute Danger / Chase Pulse
  const redR0 = minDim.mul(0.12);
  const redR1 = max(maxDim.mul(0.65), redR0.add(1.0));
  const redT = clamp(pxDist.sub(redR0).div(redR1.sub(redR0)), float(0.0), float(1.0));
  const redCol = vec3(0.485, 0.005, 0.003); // linear equivalent of #b90f0a
  const aRed = clamp(redT.mul(min(float(0.45), uRedBoost)).mul(losVal), float(0.0), float(1.0));

  // 4. LoS-clipped Spot Flash
  const flashCol = vec3(0.82, 0.098, 0.004); // linear equivalent of #ea580c
  const aFlash = clamp(uSpotFlash.mul(0.25).mul(losVal), float(0.0), float(1.0));

  // Sequential source-over equivalent folded into one blend pass
  const trans = float(1.0)
    .sub(vAlpha)
    .mul(float(1.0).sub(aSteam))
    .mul(float(1.0).sub(aRed))
    .mul(float(1.0).sub(aFlash));
  const outAlpha = clamp(float(1.0).sub(trans), float(0.0), float(1.0));

  const add1 = steamCol.mul(aSteam);
  const add2 = add1.mul(float(1.0).sub(aRed)).add(redCol.mul(aRed));
  const add3 = add2.mul(float(1.0).sub(aFlash)).add(flashCol.mul(aFlash));
  const outCol = add3.div(max(outAlpha, float(0.0001)));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = outCol;
  material.opacityNode = outAlpha;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.NormalBlending;

  return {
    material,
    losTexNode,
    uResolution,
    uSteamFog,
    uRedBoost,
    uSpotFlash,
  };
}

export interface StairPortalMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  portalTexNode: ReturnType<typeof texture>;
  portalLosTexNode: ReturnType<typeof texture>;
  uCenterDim: THREE.UniformNode<'float', number>;
  uMidDim: THREE.UniformNode<'float', number>;
  uAccentColor: THREE.UniformNode<'color', THREE.Color>;
  uPixelSpan: THREE.UniformNode<'float', number>;
}

export function createStairPortalMaterial(
  portalTex: THREE.Texture,
  portalLosTex: THREE.Texture
): StairPortalMaterialBundle {
  const portalTexNode = texture(portalTex);
  const portalLosTexNode = texture(portalLosTex);
  const uCenterDim = uniform(0.48);
  const uMidDim = uniform(0.8);
  const uAccentColor = uniform(new THREE.Color(0x38bdf8));
  const uPixelSpan = uniform(400.0);

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const centered = sampleUV.sub(vec2(0.5, 0.5)).mul(2.0);
  const r = length(centered); // 1.0 = portalRadius

  // Border widths normalized to portal radius (~3px / radius)
  const borderHalf = float(6.0).div(max(uPixelSpan, float(64.0)));
  const rimInner = float(1.0).sub(borderHalf.mul(2.0));
  const rimOuter = float(1.0);
  const aa = float(2.5).div(max(uPixelSpan, float(64.0)));

  const worldCol = portalTexNode.sample(rtUV).rgb;
  const losVal = portalLosTexNode.sample(rtUV).r;

  // Landing visibility dim gradient (0 -> 0.58 -> 1.0)
  const dimLow = clamp(r.div(0.58), float(0.0), float(1.0));
  const dimHigh = clamp(r.sub(0.58).div(0.42), float(0.0), float(1.0));
  const dimAlpha = mix(
    mix(uCenterDim, uMidDim, dimLow),
    mix(uMidDim, float(0.96), dimHigh),
    step(float(0.58), r)
  );

  // Soft circular tunnel vignette (0.62 -> 1.0 : 0 -> 0.88)
  const vigT = clamp(r.sub(0.62).div(0.38), float(0.0), float(1.0));
  const vigAlpha = vigT.mul(0.88);

  const interiorCol = worldCol
    .mul(losVal)
    .mul(float(1.0).sub(dimAlpha))
    .mul(float(1.0).sub(vigAlpha));

  // Outer dark frame (#0f172a) + thin accent ring
  const frameBg = vec3(0.005, 0.012, 0.028);
  const rimDist = abs(r.sub(rimInner.add(borderHalf)));
  const accentMask = float(1.0).sub(smoothstep(borderHalf.mul(0.28), borderHalf.mul(0.52), rimDist));
  const frameCol = mix(frameBg, uAccentColor, accentMask);

  const inBorder = smoothstep(rimInner.sub(aa), rimInner.add(aa), r);
  const finalCol = mix(interiorCol, frameCol, inBorder);
  const circleAlpha = float(1.0).sub(smoothstep(rimOuter.sub(aa), rimOuter.add(aa), r));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = finalCol;
  material.opacityNode = circleAlpha;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.NormalBlending;

  return {
    material,
    portalTexNode,
    portalLosTexNode,
    uCenterDim,
    uMidDim,
    uAccentColor,
    uPixelSpan,
  };
}

export function createScreenBlitMaterial(sourceTex: THREE.Texture): {
  material: THREE.MeshBasicNodeMaterial;
  texNode: ReturnType<typeof texture>;
} {
  const texNode = texture(sourceTex);
  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = texNode.sample(rtUV).rgb;
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  return { material, texNode };
}

export function createSrgbReadbackBlitMaterial(sourceTex: THREE.Texture): {
  material: THREE.MeshBasicNodeMaterial;
  texNode: ReturnType<typeof texture>;
} {
  const texNode = texture(sourceTex);
  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = sRGBTransferOETF(
    texNode.sample(rtUV).rgb
  ) as unknown as THREE.MeshBasicNodeMaterial['colorNode'];
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  return { material, texNode };
}

export function createBakedLightmapQuadMaterial(
  sourceTex: THREE.Texture,
  premultiplied: boolean
): {
  material: THREE.MeshBasicNodeMaterial;
  texNode: ReturnType<typeof texture>;
} {
  const texNode = texture(sourceTex);
  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const sampled = texNode.sample(rtUV);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = sampled.rgb;
  if (premultiplied) {
    material.opacityNode = sampled.a;
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  } else {
    material.transparent = false;
  }
  material.depthWrite = false;
  material.depthTest = false;
  return { material, texNode };
}

export function createThinRingBatchMaterial(): THREE.MeshBasicNodeMaterial {
  const offset = attribute('aRingOffset', 'vec2');
  const params = attribute('aRingParams', 'vec3');
  const col = attribute('aRingColor', 'vec4');

  const dist = length(offset);
  const d = abs(dist.sub(params.x));
  const halfThick = max(params.y, float(0.2));
  const aa = max(params.z, float(0.25));
  const inner = max(float(0.0), halfThick.sub(aa));
  const outer = halfThick.add(aa);
  const ringMask = float(1.0).sub(smoothstep(inner, outer, d));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = col.rgb;
  material.opacityNode = col.w.mul(ringMask);
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.NormalBlending;
  return material;
}

