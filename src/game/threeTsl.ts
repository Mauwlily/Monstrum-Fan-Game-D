import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
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

export function createBatchedRadialFanMaterial(depthTest = false): THREE.MeshBasicNodeMaterial {
  const radialOffset = attribute('aRadialOffset', 'vec2');
  const params = attribute('aFanParams', 'vec3');
  const cone = attribute('aConeParams', 'vec4');
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

  const dir = radialOffset.div(max(dist, float(0.0001)));
  const angDot = dot(dir, cone.xy);
  const coneMask = smoothstep(cone.w, cone.z, angDot);
  const originBlend = smoothstep(float(2.0), float(10.0), dist);
  const angAlpha = mix(float(1.0), coneMask, step(float(-1.2), cone.w).mul(originBlend));

  const col = mix(mix(c0.rgb, c1.rgb, tLow), mix(c1.rgb, c2.rgb, tHigh), inHigh);
  const baseAlpha = mix(mix(c0.w, c1.w, tLow), mix(c1.w, c2.w, tHigh), inHigh);
  const alpha = baseAlpha.mul(angAlpha);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = col;
  material.opacityNode = alpha;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = depthTest;
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
  uMode: THREE.UniformNode<'float', number>;
  uAoStrength: THREE.UniformNode<'float', number>;
  uTexelStep: THREE.UniformNode<'vec2', THREE.Vector2>;
}

export function createDarknessCompositeMaterial(
  sceneTex: THREE.Texture,
  losTex: THREE.Texture,
  lightTex: THREE.Texture
): CompositeMaterialBundle {
  const sceneTexNode = texture(sceneTex);
  const losTexNode = texture(losTex);
  const lightTexNode = texture(lightTex);
  const uMode = uniform(0.0);
  const uAoStrength = uniform(1.0);
  const uTexelStep = uniform(new THREE.Vector2(1 / 1280, 1 / 720));

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const sceneCol = sceneTexNode.sample(rtUV).rgb;
  const losVal = losTexNode.sample(rtUV).r;
  const lightVal = lightTexNode.sample(rtUV).r;

  // Screen-space wall/silhouette contact AO from Player LoS gradient (never leaks into #000000)
  const aoStep = uTexelStep.mul(2.4);
  const n0 = losTexNode.sample(rtUV.add(vec2(aoStep.x, aoStep.y))).r;
  const n1 = losTexNode.sample(rtUV.add(vec2(aoStep.x.negate(), aoStep.y))).r;
  const n2 = losTexNode.sample(rtUV.add(vec2(aoStep.x, aoStep.y.negate()))).r;
  const n3 = losTexNode.sample(rtUV.add(vec2(aoStep.x.negate(), aoStep.y.negate()))).r;
  const avgNeighborLos = n0.add(n1).add(n2).add(n3).mul(0.25);
  const aoFactor = mix(float(1.0), mix(float(0.76), float(1.0), avgNeighborLos), uAoStrength);

  // Strict OLED pure #000000 outside Player LoS or unlit areas, while permitting HDR light energy > 1.0
  const visibility = clamp(losVal.mul(lightVal), float(0.0), float(4.2));
  const litColor = sceneCol.mul(visibility).mul(aoFactor);

  // Debug inspection modes:
  // 0: NORMAL, 1: FULLBRIGHT, 2: LOS_ONLY, 3: LOS_MASK, 4: LIGHT_MASK
  const w0 = clamp(float(1.0).sub(abs(uMode.sub(0.0))), float(0.0), float(1.0));
  const w1 = clamp(float(1.0).sub(abs(uMode.sub(1.0))), float(0.0), float(1.0));
  const w2 = clamp(float(1.0).sub(abs(uMode.sub(2.0))), float(0.0), float(1.0));
  const w3 = clamp(float(1.0).sub(abs(uMode.sub(3.0))), float(0.0), float(1.0));
  const w4 = clamp(float(1.0).sub(abs(uMode.sub(4.0))), float(0.0), float(1.0));

  const outCol = litColor
    .mul(w0)
    .add(sceneCol.mul(w1))
    .add(sceneCol.mul(losVal).mul(w2))
    .add(vec3(losVal, losVal, losVal).mul(w3))
    .add(vec3(lightVal, lightVal, lightVal).mul(w4));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = outCol;
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;

  return {
    material,
    sceneTexNode,
    losTexNode,
    lightTexNode,
    uMode,
    uAoStrength,
    uTexelStep,
  };
}

export interface VignetteDangerMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  losTexNode: ReturnType<typeof texture>;
  uResolution: THREE.UniformNode<'vec2', THREE.Vector2>;
  uSteamFog: THREE.UniformNode<'float', number>;
  uRedBoost: THREE.UniformNode<'float', number>;
  uSpotFlash: THREE.UniformNode<'float', number>;
  uVignetteIntensity: THREE.UniformNode<'float', number>;
}

export function createVignetteAndDangerMaterial(
  losTex: THREE.Texture
): VignetteDangerMaterialBundle {
  const losTexNode = texture(losTex);
  const uResolution = uniform(new THREE.Vector2(1440, 900));
  const uSteamFog = uniform(0.0);
  const uRedBoost = uniform(0.0);
  const uSpotFlash = uniform(0.0);
  const uVignetteIntensity = uniform(1.0);

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const losVal = losTexNode.sample(rtUV).r;

  const pxDelta = rtUV.sub(vec2(0.5, 0.5)).mul(uResolution);
  const pxDist = length(pxDelta);
  const minDim = min(uResolution.x, uResolution.y);
  const maxDim = max(uResolution.x, uResolution.y);

  // 1. Pure black edge vignette (0.34*minDim -> 0.74*maxDim : 0 -> 0.82 * uVignetteIntensity)
  const vigR0 = minDim.mul(0.34);
  const vigR1 = max(maxDim.mul(0.74), vigR0.add(1.0));
  const vigT = clamp(pxDist.sub(vigR0).div(vigR1.sub(vigR0)), float(0.0), float(1.0));
  const vAlpha = clamp(vigT.mul(0.82).mul(uVignetteIntensity), float(0.0), float(0.96));

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
    uVignetteIntensity,
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

export interface BloomExtractMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  texNode: ReturnType<typeof texture>;
  uThreshold: THREE.UniformNode<'float', number>;
  uKnee: THREE.UniformNode<'float', number>;
}

export function createBloomExtractMaterial(sourceTex: THREE.Texture): BloomExtractMaterialBundle {
  const texNode = texture(sourceTex);
  const uThreshold = uniform(0.82);
  const uKnee = uniform(0.28);

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const col = texNode.sample(rtUV).rgb;
  const peak = max(col.r, max(col.g, col.b));
  const kneeDouble = max(uKnee.mul(2.0), float(0.001));
  const rq = clamp(peak.sub(uThreshold).add(uKnee), float(0.0), kneeDouble);
  const soft = rq.mul(rq).div(kneeDouble.mul(2.0));
  const contrib = max(peak.sub(uThreshold), soft).div(max(peak, float(0.0001)));
  const active = step(float(0.001), peak);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = col.mul(clamp(contrib, float(0.0), float(2.5))).mul(active);
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  return { material, texNode, uThreshold, uKnee };
}

export interface BloomBlurMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  texNode: ReturnType<typeof texture>;
  uTexelStep: THREE.UniformNode<'vec2', THREE.Vector2>;
}

export function createBloomBlurMaterial(sourceTex: THREE.Texture): BloomBlurMaterialBundle {
  const texNode = texture(sourceTex);
  const uTexelStep = uniform(new THREE.Vector2(1 / 360, 0));

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const s0 = texNode.sample(rtUV).rgb.mul(0.2941);
  const s1 = texNode.sample(rtUV.add(uTexelStep.mul(1.333))).rgb.mul(0.2353);
  const s2 = texNode.sample(rtUV.sub(uTexelStep.mul(1.333))).rgb.mul(0.2353);
  const s3 = texNode.sample(rtUV.add(uTexelStep.mul(3.0))).rgb.mul(0.1176);
  const s4 = texNode.sample(rtUV.sub(uTexelStep.mul(3.0))).rgb.mul(0.1176);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = s0.add(s1).add(s2).add(s3).add(s4);
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  return { material, texNode, uTexelStep };
}

export interface PostProcessUniforms {
  uBloomIntensity: THREE.UniformNode<'float', number>;
  uExposure: THREE.UniformNode<'float', number>;
  uToneMappingMode: THREE.UniformNode<'float', number>;
  uColorGradeMode: THREE.UniformNode<'float', number>;
  uFilmGrain: THREE.UniformNode<'float', number>;
  uTime: THREE.UniformNode<'float', number>;
  uHdrActive: THREE.UniformNode<'float', number>;
  uPaperWhiteScale: THREE.UniformNode<'float', number>;
  uHdrPeakRatio: THREE.UniformNode<'float', number>;
  uBypassLosBloomGate: THREE.UniformNode<'float', number>;
}

export interface ScreenBlitMaterialBundle extends PostProcessUniforms {
  material: THREE.MeshBasicNodeMaterial;
  texNode: ReturnType<typeof texture>;
  bloomTexNode: ReturnType<typeof texture>;
  losTexNode: ReturnType<typeof texture>;
}

function buildPostGradedLinearColor(
  sourceTex: THREE.Texture,
  bloomTex: THREE.Texture,
  losTex: THREE.Texture
) {
  const texNode = texture(sourceTex);
  const bloomTexNode = texture(bloomTex);
  const losTexNode = texture(losTex);

  const uBloomIntensity = uniform(0.45);
  const uExposure = uniform(1.0);
  const uToneMappingMode = uniform(0.0); // 0=ACES, 1=NEUTRAL, 2=REINHARD_EXTENDED
  const uColorGradeMode = uniform(0.0); // 0=COLD_HORROR, 1=AMBER_RUST, 2=NOIR_CONTRAST, 3=NEUTRAL
  const uFilmGrain = uniform(0.5);
  const uTime = uniform(0.0);
  const uHdrActive = uniform(0.0);
  const uPaperWhiteScale = uniform(1.0);
  const uHdrPeakRatio = uniform(1.0);
  const uBypassLosBloomGate = uniform(0.0);

  const sampleUV = uv();
  const rtUV = vec2(sampleUV.x, float(1.0).sub(sampleUV.y));
  const srcCol = max(texNode.sample(rtUV).rgb, vec3(0.0));
  const bloomCol = max(bloomTexNode.sample(rtUV).rgb, vec3(0.0));
  const losVal = losTexNode.sample(rtUV).r;

  // Strictly block bloom spill into #000000 behind-wall regions (unless fullbright debug bypass)
  const srcPeak = max(srcCol.r, max(srcCol.g, srcCol.b));
  const visiblePixelMask = max(losVal, smoothstep(float(0.0), float(0.015), srcPeak));
  const bloomMask = mix(visiblePixelMask, float(1.0), uBypassLosBloomGate);

  const combined = srcCol.add(bloomCol.mul(uBloomIntensity).mul(bloomMask)).mul(uExposure);
  const lumaWeights = vec3(0.2126, 0.7152, 0.0722);
  const rawLum = dot(combined, lumaWeights);

  // Color Grade (strictly multiplicative / zero-preserving at pure black)
  const g0 = clamp(float(1.0).sub(abs(uColorGradeMode.sub(0.0))), float(0.0), float(1.0));
  const g1 = clamp(float(1.0).sub(abs(uColorGradeMode.sub(1.0))), float(0.0), float(1.0));
  const g2 = clamp(float(1.0).sub(abs(uColorGradeMode.sub(2.0))), float(0.0), float(1.0));
  const g3 = clamp(float(1.0).sub(abs(uColorGradeMode.sub(3.0))), float(0.0), float(1.0));

  const coldGrade = vec3(combined.r.mul(0.93), combined.g.mul(0.99), combined.b.mul(1.09));
  const amberGrade = vec3(combined.r.mul(1.09), combined.g.mul(0.98), combined.b.mul(0.84));
  const noirDesat = mix(vec3(rawLum, rawLum, rawLum), combined, float(0.42));
  const noirGrade = pow(max(noirDesat, vec3(0.0)), vec3(1.06));
  const graded = coldGrade
    .mul(g0)
    .add(amberGrade.mul(g1))
    .add(noirGrade.mul(g2))
    .add(combined.mul(g3));

  // Tone Mapping scaled seamlessly between SDR (max = 1.0) and HDR1000 (max = peak/paperWhite)
  const peakMax = mix(float(1.0), max(uHdrPeakRatio, float(1.0)), uHdrActive);
  const invMax = float(1.0).div(peakMax);

  // 0: ACES Filmic (SDR exact fit blended cleanly to extended HDR shoulder)
  const acesSdr = graded
    .mul(graded.mul(2.51).add(0.03))
    .div(graded.mul(graded.mul(2.43).add(0.59)).add(0.14));
  const acesHdr = graded
    .mul(float(1.0).add(graded.mul(0.32)))
    .div(float(1.0).add(graded.mul(float(0.32).add(invMax))));
  const tmAces = mix(acesSdr, acesHdr, uHdrActive);

  // 1: Neutral soft filmic roll-off
  const tmNeutral = graded.div(float(1.0).add(graded.mul(invMax)));

  // 2: Reinhard Extended
  const tmReinhard = graded
    .mul(float(1.0).add(graded.mul(0.18)))
    .div(float(1.0).add(graded.mul(float(0.18).add(invMax))));

  const t0 = clamp(float(1.0).sub(abs(uToneMappingMode.sub(0.0))), float(0.0), float(1.0));
  const t1 = clamp(float(1.0).sub(abs(uToneMappingMode.sub(1.0))), float(0.0), float(1.0));
  const t2 = clamp(float(1.0).sub(abs(uToneMappingMode.sub(2.0))), float(0.0), float(1.0));
  const toneMapped = tmAces.mul(t0).add(tmNeutral.mul(t1)).add(tmReinhard.mul(t2));

  // Scale by HDR Paper White relative to 203 nits reference when HDR output is active
  const whiteScale = mix(float(1.0), uPaperWhiteScale, uHdrActive);
  const scaled = toneMapped.mul(whiteScale);
  const clampedCol = mix(
    clamp(scaled, vec3(0.0), vec3(1.0)),
    clamp(scaled, vec3(0.0), vec3(peakMax.mul(whiteScale))),
    uHdrActive
  );

  // Subtle Film Grain strictly gated above pure black so #000000 stays exact (0, 0, 0)
  const grainSeed = sampleUV.mul(vec2(129.898, 782.33)).add(vec2(fract(uTime.mul(13.71)).mul(37.0), fract(uTime.mul(7.39)).mul(53.0)));
  const grainRand = fract(sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
  const outLum = dot(clampedCol, lumaWeights);
  const grainGate = smoothstep(float(0.0), float(0.032), outLum);
  const finalLinear = max(
    vec3(0.0),
    clampedCol.add(vec3(grainRand, grainRand, grainRand).mul(uFilmGrain.mul(0.055).mul(grainGate)))
  );

  return {
    linearColor: finalLinear,
    texNode,
    bloomTexNode,
    losTexNode,
    uniforms: {
      uBloomIntensity,
      uExposure,
      uToneMappingMode,
      uColorGradeMode,
      uFilmGrain,
      uTime,
      uHdrActive,
      uPaperWhiteScale,
      uHdrPeakRatio,
      uBypassLosBloomGate,
    },
  };
}

export function createScreenBlitMaterial(
  sourceTex: THREE.Texture,
  bloomTex: THREE.Texture,
  losTex: THREE.Texture
): ScreenBlitMaterialBundle {
  const post = buildPostGradedLinearColor(sourceTex, bloomTex, losTex);
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = post.linearColor;
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  return {
    material,
    texNode: post.texNode,
    bloomTexNode: post.bloomTexNode,
    losTexNode: post.losTexNode,
    ...post.uniforms,
  };
}

export function createSrgbReadbackBlitMaterial(
  sourceTex: THREE.Texture,
  bloomTex: THREE.Texture,
  losTex: THREE.Texture
): ScreenBlitMaterialBundle {
  const post = buildPostGradedLinearColor(sourceTex, bloomTex, losTex);
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = sRGBTransferOETF(
    clamp(post.linearColor, vec3(0.0), vec3(1.0))
  ) as unknown as THREE.MeshBasicNodeMaterial['colorNode'];
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  return {
    material,
    texNode: post.texNode,
    bloomTexNode: post.bloomTexNode,
    losTexNode: post.losTexNode,
    ...post.uniforms,
  };
}

export function createBakedLightmapQuadMaterial(
  sourceTex: THREE.Texture,
  premultiplied: boolean,
  depthTest = false
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
  } else if (depthTest) {
    material.opacityNode = float(1.0);
    material.transparent = true;
    material.blending = THREE.NormalBlending;
  } else {
    material.transparent = false;
  }
  material.depthWrite = false;
  material.depthTest = depthTest;
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

export interface ShadedCharacterMaterialOptions {
  color?: number;
  map?: THREE.Texture;
  roughness?: number;
  metalness?: number;
  emissiveColor?: number;
  emissiveStrength?: number;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  side?: THREE.Side;
}

export interface ShadedCharacterMaterialBundle {
  material: THREE.MeshBasicNodeMaterial;
  uTint: THREE.UniformNode<'color', THREE.Color>;
  uEmissive: THREE.UniformNode<'color', THREE.Color>;
  uEmissiveStrength: THREE.UniformNode<'float', number>;
}

export function createShadedCharacterMaterial(
  opts: ShadedCharacterMaterialOptions = {}
): ShadedCharacterMaterialBundle {
  const uTint = uniform(new THREE.Color(opts.color ?? 0xffffff));
  const uEmissive = uniform(new THREE.Color(opts.emissiveColor ?? 0x000000));
  const uEmissiveStrength = uniform(opts.emissiveStrength ?? 0.0);

  const roughness = Math.min(1, Math.max(0.08, opts.roughness ?? 0.65));
  const metalness = Math.min(1, Math.max(0, opts.metalness ?? 0.15));

  const N = normalize(normalWorld);
  const V = normalize(cameraPosition.sub(positionWorld));

  // Virtual 3-point studio lighting aligned to our top-down/tilted deck world (+Z up, -Y down)
  const keyDir = normalize(vec3(0.32, -0.44, 0.84));
  const fillDir = normalize(vec3(-0.56, 0.42, 0.36));

  const nDotKey = max(dot(N, keyDir), float(0.0));
  const nDotFill = max(dot(N, fillDir), float(0.0));
  const hemi = clamp(N.z.mul(0.5).add(0.5), float(0.0), float(1.0));

  // Rich depth contrast: deep underside crevices (~0.36) up to crisp upper highlights (~1.12)
  const hemiLight = mix(vec3(0.28, 0.31, 0.37), vec3(0.76, 0.78, 0.82), hemi);
  const keyLight = vec3(1.06, 0.99, 0.92).mul(nDotKey.mul(0.68));
  const fillLight = vec3(0.38, 0.48, 0.64).mul(nDotFill.mul(0.28));

  const halfVec = normalize(keyDir.add(V));
  const nDotH = max(dot(N, halfVec), float(0.0));
  const specPower = 8.0 + (1.0 - roughness) * 44.0;
  const specWeight = (1.0 - roughness) * (0.24 + metalness * 0.42);
  const spec = pow(nDotH, float(specPower)).mul(float(specWeight));

  const fresnelBase = clamp(float(1.0).sub(max(dot(N, V), float(0.0))), float(0.0), float(1.0));
  const rimWeight = 0.14 + metalness * 0.24;
  const rim = pow(fresnelBase, float(2.5)).mul(float(rimWeight)).mul(hemi.mul(0.6).add(0.4));

  const baseColor = opts.map ? texture(opts.map).rgb.mul(uTint.rgb) : uTint.rgb;
  const diffuseTerm = hemiLight.add(keyLight).add(fillLight);
  const specularTint = mix(vec3(1.0, 0.97, 0.94), baseColor, float(metalness * 0.55));
  const rimTint = vec3(0.66, 0.75, 0.88);

  const shadedColor = baseColor
    .mul(diffuseTerm)
    .add(specularTint.mul(spec))
    .add(rimTint.mul(rim))
    .add(uEmissive.rgb.mul(uEmissiveStrength));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = shadedColor;
  material.transparent = opts.transparent ?? false;
  if (opts.opacity !== undefined) {
    material.opacityNode = float(opts.opacity);
  }
  material.depthTest = true;
  material.depthWrite = opts.depthWrite ?? !(opts.transparent ?? false);
  material.side = opts.side ?? THREE.FrontSide;

  return {
    material,
    uTint,
    uEmissive,
    uEmissiveStrength,
  };
}

