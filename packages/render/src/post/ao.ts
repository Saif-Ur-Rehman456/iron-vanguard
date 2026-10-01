/**
 * Ambient occlusion — written for this scene rather than borrowed.
 *
 * Why there is a custom pass here (docs/decisions/0012-rendering-foundation.md):
 * `GTAOPass`'s depth-fed path sampled a depth texture the scene never wrote to.
 * `EffectComposer` builds `renderTarget2 = renderTarget1.clone()`, and
 * `RenderTarget.copy()` gives the clone its **own** depth texture (it clones a
 * depth texture the source owns), while `RenderPass` draws the scene into
 * `readBuffer` — which starts as `renderTarget2`. So the pass read an untouched
 * depth buffer: view positions came out at the far plane, reconstructed normals
 * were garbage, and the AO buffer measured pure white with a ~6% frame-wide wash
 * and a 0% contact term. The measurement is in apps/harness/src/shots.ts
 * (`--aodebug=1`), and it is the reason this file exists.
 *
 * The pass therefore takes depth **from the buffer the scene was just drawn into**
 * (`readBuffer.depthTexture`), which is correct whatever the composer has swapped.
 *
 * Two radii, because "grounded" and "cornered" are different distances:
 *  - `contactRadius` (~0.3 m) is what puts a tyre, a boot or a barrier on the
 *    ground: geometry this close to a surface is what touches it.
 *  - `ambientRadius` (~1.2 m) is the soft corner/joint darkening where two
 *    surfaces meet.
 * A single radius cannot do both: small alone leaves corners flat, large alone
 * smears a grey stain across the ground instead of a contact patch.
 *
 * Deliberately *not* included: any term that reads world position or normals from
 * a G-buffer. Depth reconstruction costs two extra taps and cannot disagree with
 * the frame it is applied to.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export interface AoOptions {
  /** Tight contact radius in metres — this is the grounding term. */
  contactRadius: number;
  /** Wider corner/joint radius in metres. */
  ambientRadius: number;
  /** How much of the occlusion is applied at most (1 = full). */
  intensity: number;
  /** Curve on the AO term: >1 tightens it toward the contact edge. */
  power: number;
  /**
   * Cosine threshold for "this occluder is above my surface" — 0.06 keeps the
   * shaded surface's own depth noise out of the term at any slope, while a wall
   * or a wheel still clears it by a wide margin.
   */
  bias: number;
  /**
   * Slack (m) beyond a sample's own distance that an occluder may sit and still
   * count. It exists so the *radius* sets the reach instead of the screen-space
   * projection: the previous metre-scale window let a wall 2 m from the sample
   * darken it, which measured as 68% darkening 1 m out from a wall base and a
   * 20% stain 2 m out.
   */
  thickness: number;
  /** Samples per radius, per pixel. */
  samples: number;
  /** AO buffer resolution relative to the drawing buffer. */
  scale: number;
  /** Bilateral denoise of the AO buffer (removes the sample-pattern noise). */
  blur: boolean;
}

export type AoOutput = 'composite' | 'ao' | 'depth' | 'normal';

const MAX_SAMPLES = 24;

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/** Shared helpers: depth → view position, view normal from depth differences. */
const AO_COMMON = /* glsl */ `
  #include <packing>

  uniform sampler2D tDepth;
  uniform mat4 uProj;
  uniform mat4 uProjInv;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;

  float readDepth( const in vec2 uv ) {
    return texture2D( tDepth, uv ).x;
  }

  vec3 viewPosition( const in vec2 uv, const in float depth ) {
    vec4 clip = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
    vec4 view = uProjInv * clip;
    return view.xyz / view.w;
  }

  /** Linear (positive) distance from the camera for a depth-buffer value. */
  float linearDepth( const in float depth ) {
    return -perspectiveDepthToViewZ( depth, uNear, uFar );
  }

  /**
   * View-space normal from the depth buffer.
   *
   * The neighbour is taken from whichever side of the centre pixel is *closer*:
   * at a silhouette the far side is unrelated geometry, and using it tilts the
   * normal into a dark halo along every edge. Picking the near side keeps the
   * normal on the surface we are shading.
   */
  vec3 normalFromDepth( const in vec2 uv, const in vec3 center ) {
    vec2 texel = 1.0 / uResolution;
    float left = readDepth( uv - vec2( texel.x, 0.0 ) );
    float right = readDepth( uv + vec2( texel.x, 0.0 ) );
    float down = readDepth( uv - vec2( 0.0, texel.y ) );
    float up = readDepth( uv + vec2( 0.0, texel.y ) );

    vec3 dx = right < left
      ? viewPosition( uv + vec2( texel.x, 0.0 ), right ) - center
      : center - viewPosition( uv - vec2( texel.x, 0.0 ), left );
    vec3 dy = up < down
      ? viewPosition( uv + vec2( 0.0, texel.y ), up ) - center
      : center - viewPosition( uv - vec2( 0.0, texel.y ), down );

    vec3 normal = cross( dx, dy );
    float length2 = dot( normal, normal );
    // A degenerate frame (depth buffer all one value) must not produce NaNs.
    if ( length2 < 1e-12 ) return vec3( 0.0, 0.0, 1.0 );
    normal /= sqrt( length2 );
    // Face the camera: depth-reconstructed normals have no handedness of their own.
    return normal.z < 0.0 ? -normal : normal;
  }

  mat3 tangentFrame( const in vec3 normal ) {
    vec3 up = abs( normal.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
    vec3 tangent = normalize( cross( up, normal ) );
    vec3 bitangent = cross( normal, tangent );
    return mat3( tangent, bitangent, normal );
  }

  float hash12( const in vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }
`;

const AO_FRAGMENT = /* glsl */ `
  ${AO_COMMON}

  uniform float uContactRadius;
  uniform float uAmbientRadius;
  uniform float uIntensity;
  uniform float uPower;
  uniform float uBias;
  uniform float uThickness;
  uniform int uSamples;
  uniform int uMode; // 0 composite, 1 AO, 2 depth, 3 normal

  varying vec2 vUv;

  /**
   * Occlusion at one radius: cosine-weighted hemisphere samples around the
   * view-space normal, each resolved to the scene point actually visible through
   * the sample's pixel and measured *in three dimensions*.
   *
   * Two earlier formulations are worth recording, because both looked reasonable
   * and both measured wrong (docs/ART_BIBLE.md has the tables):
   *
   *  1. "Is the depth buffer nearer than my sample point?" — a flat 4% wash over
   *     the whole frame and 0% at a barrel base. On any surface not facing the
   *     camera head-on, the surface's own depth gradient overtakes the hemisphere
   *     radius, so every sample reads as occluded while real contact occlusion
   *     disappears into the average.
   *  2. The tangent-plane version that replaced it — slope-correct, and it did
   *     find corners, but it judged occlusion along the *view ray* through the
   *     sample's pixel, so anything on that ray nearer than the plane counted. On
   *     a ground point 2 m from a wall, the sample rays still crossed the wall,
   *     and with a 2 m thickness window that measured as 68% darkening a metre
   *     out from the wall base. Reach was set by screen-space projection, not by
   *     the radius; a small barrel 0.38 m away, occupying few pixels, got nothing.
   *
   * Hence this version: the occluder is the scene point at the sample's pixel,
   * and it counts only if it is within the sample's own distance (plus a small
   * slack) *and* in the surface's upper hemisphere. The radius therefore means
   * what it says — ground within 0.7 m of a wall base darkens, ground 2 m away
   * does not — and the term stops depending on how much of the screen an object
   * happens to cover.
   *
   * Cosine weighting is not applied again here: the samples are already
   * distributed with cosine density, so counting each blocked sample once and
   * dividing by the sample count is the integral over the projected hemisphere.
   */
  float occlusionAt(
    const in vec3 center,
    const in mat3 frame,
    const in vec3 normal,
    const in float radius,
    const in float angle
  ) {
    float occlusion = 0.0;
    float valid = 0.0;
    float step = 2.39996323; // golden angle: even coverage without a texture
    for ( int i = 0; i < ${MAX_SAMPLES}; i++ ) {
      if ( i >= uSamples ) break;
      float fi = float( i );
      float u = ( fi + 0.5 ) / float( uSamples );
      // Cosine-weighted hemisphere: r = sqrt(u) concentrates samples near the pole.
      float r = sqrt( u );
      float theta = fi * step + angle;
      vec3 dir = vec3( r * cos( theta ), r * sin( theta ), sqrt( max( 0.0, 1.0 - r * r ) ) );
      // Distance ramp: every sample is pushed out along its own direction, biased
      // to the near field — a contact term that only ever samples at full radius
      // misses the 5 cm between a tyre and the tarmac.
      //
      // "Biased to the near field" has to mean *near*: at 0.35 the closest of six
      // samples sits 0.28 m out (0.4 x the 0.7 m contact radius), so a 0.45 m barrel
      // seen from 0.35 m away cannot be reached by a single sample and its base
      // measured as 2.9% darker than open ground while the term's own noise cost the
      // flattest surface in the build 7.4% of its light. 0.15 puts the nearest sample
      // at 0.105 m, which is where a tyre meets tarmac, and the higher bias (above)
      // is what keeps the closer samples from reading the surface's own depth.
      float distance = radius * ( 0.15 + 0.85 * u );
      vec3 samplePosition = center + frame * dir * distance;

      vec4 offset = uProj * vec4( samplePosition, 1.0 );
      if ( offset.w <= 0.0 ) continue;
      vec2 sampleUv = offset.xy / offset.w * 0.5 + 0.5;
      if ( sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0 ) continue;

      // The scene point visible through that pixel is the only possible occluder.
      vec3 occluder = viewPosition( sampleUv, readDepth( sampleUv ) );
      vec3 delta = occluder - center;
      float reach = length( delta );

      valid += 1.0;
      // Locality: nothing further than this sample's own reach can occlude the
      // point, whatever it covers on screen.
      if ( reach > distance + uThickness ) continue;
      // And it has to sit above the surface, which excludes the shaded surface's
      // own depth noise — the sample's projection lands on the surface itself on
      // any slope, and that delta is parallel to the plane.
      if ( dot( normal, delta ) / max( reach, 1e-4 ) > uBias ) occlusion += 1.0;
    }
    return valid > 0.0 ? occlusion / valid : 0.0;
  }

  void main() {
    float depth = readDepth( vUv );
    vec3 center = viewPosition( vUv, depth );
    vec3 normal = normalFromDepth( vUv, center );

    if ( uMode == 2 ) {
      // Linear depth, normalised over the cascade range: flat grey = the depth
      // texture is not being fed (the bug this pass was written to fix).
      float distance = linearDepth( depth );
      float sky = depth >= 1.0 ? 1.0 : 0.0;
      gl_FragColor = vec4( vec3( mix( clamp( distance / 120.0, 0.0, 1.0 ), 1.0, sky ) ), 1.0 );
      return;
    }
    if ( uMode == 3 ) {
      gl_FragColor = vec4( normal * 0.5 + 0.5, 1.0 );
      return;
    }

    // Sky and the far plane have nothing to occlude them.
    if ( depth >= 1.0 ) {
      gl_FragColor = vec4( 1.0, 1.0, 1.0, 1.0 );
      return;
    }

    // A per-pixel rotation keeps the 2D sample pattern from reading as rings.
    // It is a hash of the pixel coordinate and *not* of time, so the term is
    // stable: a camera that does not move does not shimmer.
    float angle = hash12( gl_FragCoord.xy ) * 6.2831853;
    mat3 frame = tangentFrame( normal );

    float contact = occlusionAt( center, frame, normal, uContactRadius, angle );
    float ambient = occlusionAt( center, frame, normal, uAmbientRadius, angle + 2.1 );

    // The contact term is what grounds an object, so it carries the weight; the
    // ambient term only deepens corners.
    float occlusion = clamp( contact + ambient * 0.55, 0.0, 1.0 );
    float ao = pow( 1.0 - occlusion, uPower );
    ao = mix( 1.0, ao, uIntensity );

    if ( uMode == 1 ) {
      gl_FragColor = vec4( vec3( ao ), 1.0 );
      return;
    }
    gl_FragColor = vec4( vec3( ao ), ao );
  }
`;

const BLUR_FRAGMENT = /* glsl */ `
  ${AO_COMMON}

  uniform sampler2D tAo;
  uniform float uBlurScale;

  varying vec2 vUv;

  void main() {
    vec2 texel = uBlurScale / uResolution;
    float centerDepth = readDepth( vUv );
    bool sky = centerDepth >= 1.0;
    float centerDistance = sky ? 0.0 : linearDepth( centerDepth );

    /*
     * The range tolerance has to admit the surface's own slope *within the blur
     * footprint*, or the denoise switches itself off exactly where the term is
     * noisiest.
     *
     * It was "max( 0.05, distance * 0.02 )" — at 30 m that is 0.6 m, which sounds
     * generous until you price a grazing plane: looking down the road, a metre of
     * ground falls about a metre per texel, so neighbouring AO texels differed by
     * more than the tolerance and every tap was weighted to zero. Measured: the AO
     * buffer was *identical* with the blur on and off on the far ground (hf 0.00924
     * either way), i.e. the pass that exists to remove the 6-sample noise was doing
     * nothing on the one surface that carries it.
     *
     * So the tolerance is the depth the blur radius itself spans along the surface,
     * with a factor of two of headroom. A tap that follows the surface is admitted
     * whatever its slope; a silhouette — metres of depth change inside a blur radius
     * — is still rejected.
     */
    float slopeX = abs( linearDepth( readDepth( vUv + vec2( texel.x, 0.0 ) ) ) - centerDistance );
    float slopeY = abs( linearDepth( readDepth( vUv + vec2( 0.0, texel.y ) ) ) - centerDistance );
    float footprint = max( slopeX, slopeY ) * uBlurScale * 2.0;

    // 8 taps on a rotated cross. The weights are depth-aware, so the blur cannot
    // wash AO across a silhouette: a sample from a different surface (a wall
    // behind a barrel) is rejected rather than smeared onto the barrel.
    vec2 offsets[8];
    offsets[0] = vec2(  1.0,  0.0 );
    offsets[1] = vec2( -1.0,  0.0 );
    offsets[2] = vec2(  0.0,  1.0 );
    offsets[3] = vec2(  0.0, -1.0 );
    offsets[4] = vec2(  0.7,  0.7 );
    offsets[5] = vec2( -0.7, -0.7 );
    offsets[6] = vec2(  0.7, -0.7 );
    offsets[7] = vec2( -0.7,  0.7 );

    float total = 1.0;
    float sum = texture2D( tAo, vUv ).r;

    for ( int i = 0; i < 8; i++ ) {
      vec2 uv = vUv + offsets[ i ] * texel;
      float sampleDepth = readDepth( uv );
      float weight = 1.0;
      if ( !sky ) {
        // Relative depth difference: a fixed metre threshold stops separating
        // surfaces as soon as they are 50 m away.
        float difference = abs( linearDepth( sampleDepth ) - centerDistance );
        float tolerance = max( max( 0.05, centerDistance * 0.02 ), footprint );
        float z = difference / tolerance;
        weight = exp( -z * z );
      }
      sum += texture2D( tAo, uv ).r * weight;
      total += weight;
    }

    float ao = sum / total;
    gl_FragColor = vec4( vec3( ao ), ao );
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tAo;
  uniform int uMode;

  varying vec2 vUv;

  void main() {
    vec4 scene = texture2D( tDiffuse, vUv );
    float ao = texture2D( tAo, vUv ).r;
    if ( uMode != 0 ) {
      // Debug views pass through untouched: they are the *term*, not the frame.
      gl_FragColor = vec4( vec3( ao ), 1.0 );
      return;
    }
    // AO multiplies the HDR frame in linear space, before bloom and the tone map,
    // so occluded pixels bloom less as well — which is most of what makes a
    // contact patch read as contact rather than as a painted dark ring.
    gl_FragColor = vec4( scene.rgb * ao, scene.a );
  }
`;

export class AoPass extends Pass {
  private readonly aoMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly aoQuad: FullScreenQuad;
  private readonly blurQuad: FullScreenQuad;
  private readonly compositeQuad: FullScreenQuad;
  private aoTarget: THREE.WebGLRenderTarget;
  private blurTarget: THREE.WebGLRenderTarget;
  private options: AoOptions;
  private output: AoOutput = 'composite';
  /**
   * Fallback depth texture (the one attached to the composer's first target). The
   * pass prefers `readBuffer.depthTexture` at render time, because that is the
   * buffer the scene was actually drawn into this frame.
   */
  private depthTexture: THREE.DepthTexture | null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    depthTexture: THREE.DepthTexture | null,
    width: number,
    height: number,
    options: AoOptions,
  ) {
    super();
    this.options = options;
    this.depthTexture = depthTexture;

    const scale = Math.max(0.25, Math.min(1, options.scale));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    this.aoTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.aoTarget.texture.name = 'IronVanguard.ao';
    // No mipmaps and nearest+linear filtering: the AO buffer is sampled 1:1 (or
    // upscaled), and generating mips for it would be pure cost.
    this.aoTarget.texture.minFilter = THREE.LinearFilter;
    this.aoTarget.texture.magFilter = THREE.LinearFilter;
    this.aoTarget.texture.generateMipmaps = false;
    this.blurTarget = this.aoTarget.clone();
    this.blurTarget.texture.name = 'IronVanguard.aoBlurred';

    this.aoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: depthTexture },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2(w, h) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uContactRadius: { value: options.contactRadius },
        uAmbientRadius: { value: options.ambientRadius },
        uIntensity: { value: options.intensity },
        uPower: { value: options.power },
        uBias: { value: options.bias },
        uThickness: { value: options.thickness },
        uSamples: { value: Math.min(MAX_SAMPLES, Math.max(1, Math.round(options.samples))) },
        uMode: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: AO_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: depthTexture },
        tAo: { value: this.aoTarget.texture },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2(w, h) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        // 2.6 AO texels, not 1.35. The term is six stochastic hemisphere samples with a
        // per-pixel rotation: its noise has a one-texel grain, and eight taps inside a
        // ±1.35-texel cross cannot average that out — measured on the frame, the blur was
        // worth 3% of the far ground's high-frequency energy before the tolerance fix and
        // 12% after it. The contact edge does not soften with it, because the weights are
        // depth-aware: a wider *surface-following* blur is not a wider blur across a
        // silhouette.
        uBlurScale: { value: 2.6 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tAo: { value: this.aoTarget.texture },
        uMode: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.aoQuad = new FullScreenQuad(this.aoMaterial);
    this.blurQuad = new FullScreenQuad(this.blurMaterial);
    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);

    this.needsSwap = true;
  }

  /** Debug view selector, so a probe can look at the term instead of the frame. */
  setOutput(mode: AoOutput): void {
    this.output = mode;
    this.aoMaterial.uniforms.uMode!.value = mode === 'ao' ? 1 : mode === 'depth' ? 2 : mode === 'normal' ? 3 : 0;
    this.compositeMaterial.uniforms.uMode!.value = this.aoMaterial.uniforms.uMode!.value;
  }

  get outputMode(): AoOutput {
    return this.output;
  }

  /** Live tuning (the sweep in apps/harness/src/shots.ts drives this). */
  setParams(params: Partial<AoOptions>): void {
    this.options = { ...this.options, ...params };
    const uniforms = this.aoMaterial.uniforms;
    uniforms.uContactRadius!.value = this.options.contactRadius;
    uniforms.uAmbientRadius!.value = this.options.ambientRadius;
    uniforms.uIntensity!.value = this.options.intensity;
    uniforms.uPower!.value = this.options.power;
    uniforms.uBias!.value = this.options.bias;
    uniforms.uThickness!.value = this.options.thickness;
    uniforms.uSamples!.value = Math.min(MAX_SAMPLES, Math.max(1, Math.round(this.options.samples)));
  }

  get params(): AoOptions {
    return this.options;
  }

  override setSize(width: number, height: number): void {
    const scale = Math.max(0.25, Math.min(1, this.options.scale));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    this.aoTarget.setSize(w, h);
    this.blurTarget.setSize(w, h);
    this.aoMaterial.uniforms.uResolution!.value.set(w, h);
    this.blurMaterial.uniforms.uResolution!.value.set(w, h);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // The scene was drawn into `readBuffer` this frame — that is where its depth
    // lives, and taking it from anywhere else is what broke the pass this
    // replaces. The fallback covers a composer that has not swapped yet.
    const depth = readBuffer.depthTexture ?? this.depthTexture;
    const uniforms = this.aoMaterial.uniforms;
    uniforms.tDepth!.value = depth;
    uniforms.uProj!.value.copy(this.camera.projectionMatrix);
    uniforms.uProjInv!.value.copy(this.camera.projectionMatrixInverse);
    uniforms.uNear!.value = this.camera.near;
    uniforms.uFar!.value = this.camera.far;
    this.blurMaterial.uniforms.tDepth!.value = depth;
    this.blurMaterial.uniforms.uProj!.value.copy(this.camera.projectionMatrix);
    this.blurMaterial.uniforms.uProjInv!.value.copy(this.camera.projectionMatrixInverse);
    this.blurMaterial.uniforms.uNear!.value = this.camera.near;
    this.blurMaterial.uniforms.uFar!.value = this.camera.far;

    renderer.setRenderTarget(this.aoTarget);
    this.aoQuad.render(renderer);

    let aoTexture = this.aoTarget.texture;
    if (this.options.blur && this.output === 'composite') {
      this.blurMaterial.uniforms.tAo!.value = this.aoTarget.texture;
      renderer.setRenderTarget(this.blurTarget);
      this.blurQuad.render(renderer);
      aoTexture = this.blurTarget.texture;
    }

    this.compositeMaterial.uniforms.tDiffuse!.value = readBuffer.texture;
    this.compositeMaterial.uniforms.tAo!.value = aoTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);
  }

  override dispose(): void {
    this.aoTarget.dispose();
    this.blurTarget.dispose();
    this.aoMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.aoQuad.dispose();
    this.blurQuad.dispose();
    this.compositeQuad.dispose();
  }
}
