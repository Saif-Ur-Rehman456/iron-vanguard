/**
 * The look pass — the last stage before screen-space AA.
 *
 * Everything upstream of this file is physically motivated (PBR materials, IBL,
 * cascaded moon shadows, ambient occlusion). This pass is deliberately *not*
 * physical: it is the filmic grade that turns a correctly-exposed render into an
 * image with depth —
 * a gentle S-curve, a highlight shoulder so emitters roll off instead of clipping
 * to flat white, a small cool lift so shadow detail survives, and a split-tone
 * (cool shadows / warm highlights) that separates the moonlit field from the
 * lamp-lit pools.
 *
 * It runs after `OutputPass`, i.e. in display space, because that is where a
 * colourist would sit: the tone map has already decided how the scene maps to
 * 0..1, and the grade decides how that negative is printed.
 *
 * Numbers here are the ones measured in docs/ART_BIBLE.md — change them with a
 * `npm run shots` before/after, not by taste alone.
 */
import type * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Exposure, tone mapping and atmosphere: the three knobs that set the base image. */
export const LOOK = {
  /**
   * AgX is a filmic curve with a long shoulder: it needs more exposure than the
   * ACESFilmic it replaced to land the same midtone, and it does not desaturate
   * highlights back toward beige.
   *
   * Trimmed from 1.35 in the lighting pass (ADR-0013): the rig now has a real key
   * light, so the same exposure put the lamp pools and the muzzle flash into the
   * shoulder instead of leaving them room to read as sources.
   */
  exposure: 1.24,
  /**
   * Cool grey-blue haze instead of the prototype's warm beige.
   *
   * This is also the atmosphere: `FogExp2` mixes the frame toward this colour with
   * distance, so contrast *and* saturation fall off together as things recede and
   * the foreground keeps its own values. That is why there is no separate aerial
   * perspective pass — a fog that is only slightly cool would flatten the distance
   * without desaturating it, so the colour matters as much as the density.
   *
   * Deliberately *dim* (`0x4b5567`, not the mid-grey it replaced): in a night frame a
   * bright haze is a light source nobody asked for — a dusk-grey (#8b8f96) fog made
   * the far end of the plaza the brightest region of the image, which is the same
   * "everything is one brightness band" failure in the other direction.
   */
  fogColor: 0x39404f,
  /**
   * The haze multiplier, on top of the map's own `ambient.fogDensity` and the
   * atmosphere's scale.
   *
   * Cut from 0.85 in ADR-0017. Aerial perspective is what makes distance readable, but
   * it was doing more than that: with a *bright* fog colour the far third of the plaza
   * converged on a pale grey wash, which is the review's "everything is dhundla" —
   * haze that reads as a soft picture rather than as air. The colour came down with it
   * (`0x39404f`, a dim blue-grey) because in a night frame the fog's brightness is a
   * light source nobody asked for.
   *
   * The morning preset keeps its own, thinner and warmer haze: a 0620 sun through
   * morning air is a real thing, and it is the *difference* between the two
   * atmospheres that makes the choice in the deploy menu mean something.
   */
  fogDensityScale: 0.62,
} as const;

const LookShader = {
  name: 'LookShader',
  uniforms: {
    tDiffuse: { value: null },
    /** Strength of the S-curve about `pivot` (1 = untouched). */
    contrast: { value: 1.12 },
    /** Where the S-curve pivots: below mid-grey, so the shadows keep their length. */
    pivot: { value: 0.4 },
    /**
     * Compresses values above `shoulder` toward 1.0 instead of clipping them.
     *
     * The highlight guard. The asked-for behaviour is "the centre of a source may
     * be strong, but its glow must be gradual": the shoulder is what makes a lamp
     * lens or a muzzle flash approach white asymptotically instead of clamping to a
     * flat disc, and the bloom threshold (quality.ts) decides how much of that
     * reaches the neighbours.
     */
    shoulder: { value: 0.82 },
    /**
     * Extra light in the darks so the tone map never crushes them to pure black.
     *
     * This is the *fill* half of "dark objects keep edge and surface detail": it is
     * cool-tinted (see `shadowTint`) and weighted by (1 - luma), so black polymer
     * gains a readable edge without becoming grey.
     */
    lift: { value: 0.024 },
    saturation: { value: 1.04 },
    /** Cool-shadows / warm-highlights separation: the moon-versus-lamp split. */
    splitTone: { value: 0.06 },
    shadowTint: { value: [0.78, 0.88, 1.15] },
    highlightTint: { value: [1.08, 1.0, 0.9] },
    /**
     * Upscale compensation, 0 at native resolution (ADR-0016/0017).
     *
     * A browser bilinear upscale is a low-pass filter: it removes the micro-contrast
     * that makes a surface read as a surface, which is why an upscaled frame looks
     * *blurry* rather than merely *soft*. This is the term that puts it back, and it
     * lives here rather than in a pass of its own because it is a one-tap-per-neighbour
     * operation in the same space as the grade: two full-resolution passes that each
     * read the whole buffer became one (ADR-0017).
     */
    sharpen: { value: 0 },
    /** One drawing-buffer texel, in UV. */
    texel: { value: [1 / 1920, 1 / 1080] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float pivot;
    uniform float shoulder;
    uniform float lift;
    uniform float saturation;
    uniform float splitTone;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;
    uniform float sharpen;
    uniform vec2 texel;
    varying vec2 vUv;

    const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

    void main() {
      vec3 color = texture2D( tDiffuse, vUv ).rgb;

      // Upscale compensation, before the curve so that what is sharpened is the image
      // the tone map and the grade then agree on. A cross-shaped unsharp mask: the
      // neighbours average to a local mean, and what is added back is the difference
      // between the centre and that mean — edge detail, not brightness.
      if ( sharpen > 0.0 ) {
        vec3 n = texture2D( tDiffuse, vUv + vec2( 0.0, texel.y ) ).rgb;
        vec3 s = texture2D( tDiffuse, vUv - vec2( 0.0, texel.y ) ).rgb;
        vec3 w = texture2D( tDiffuse, vUv - vec2( texel.x, 0.0 ) ).rgb;
        vec3 e = texture2D( tDiffuse, vUv + vec2( texel.x, 0.0 ) ).rgb;
        color += ( color - ( n + s + w + e ) * 0.25 ) * sharpen;
      }

      // Black lift before the curve: the lift is applied where the image is dark
      // (weighted by 1 - luma) so midtones are untouched.
      float luma = dot( clamp( color, 0.0, 1.0 ), LUMA );
      color += lift * shadowTint * ( 1.0 - smoothstep( 0.0, 0.5, luma ) );

      // S-curve about the pivot.
      color = ( color - pivot ) * contrast + pivot;

      // Highlight shoulder: an emitter can be arbitrarily bright, but it should
      // approach white rather than become a flat clipped blob.
      vec3 over = max( color - shoulder, 0.0 );
      float head = 1.0 - shoulder;
      color = min( color, vec3( shoulder ) ) + head * ( 1.0 - exp( - over / head ) );

      // Saturation, then the split-tone separation.
      luma = dot( clamp( color, 0.0, 1.0 ), LUMA );
      color = mix( vec3( luma ), color, saturation );
      color += splitTone * ( ( 1.0 - luma ) * ( shadowTint - 1.0 ) + luma * ( highlightTint - 1.0 ) );

      gl_FragColor = vec4( clamp( color, 0.0, 1.0 ), 1.0 );
    }
  `,
};

/**
 * The grade, as a composer pass, plus the upscale compensation that used to be a pass
 * of its own.
 *
 * A `ShaderPass` already handles resizing, so this adds no size bookkeeping of its own
 * (and therefore cannot reintroduce the mid-frame resize that used to flash the screen
 * black).
 */
export interface LookPass {
  pass: ShaderPass;
  /**
   * Turn the upscale compensation on/off and keep its texel size current.
   *
   * Called from `syncSharpen()` with the adaptive controller's verdict, and with the
   * drawing-buffer size — never with CSS pixels, because the texel has to match the
   * buffer the pass is reading, not the window it is shown in.
   */
  setSharpen(amount: number, width: number, height: number): void;
}

export function createLookPass(): LookPass {
  const pass = new ShaderPass(LookShader);
  return {
    pass,
    setSharpen(amount, width, height) {
      const uniform = pass.uniforms.sharpen as THREE.IUniform<number>;
      const texel = pass.uniforms.texel as THREE.IUniform<[number, number]>;
      uniform.value = amount;
      texel.value = [1 / Math.max(1, width), 1 / Math.max(1, height)];
    },
  };
}
