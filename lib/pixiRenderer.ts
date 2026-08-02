// PixiJS presentation layer. The CPU-composited paint grid uploads as a
// buffer texture each frame and is drawn by a custom mesh shader that adds
// wet-paint shading (mask-derived normals, blinn specular, moving sheen).
// Sparks render as pooled GPU sprites with additive glow on dark themes —
// far more particles than canvas compositing could afford.
// Returns null when WebGL is unavailable; the caller falls back to 2D.

import { RGB, P, type Spark } from "./engine";

const VERT = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = aUvs;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uSampler;
uniform float uT;
uniform vec2 uPx;
void main() {
  vec4 c = texture2D(uSampler, vUv);
  float a = c.a;
  float ax1 = texture2D(uSampler, vUv - vec2(uPx.x, 0.0)).a;
  float ax2 = texture2D(uSampler, vUv + vec2(uPx.x, 0.0)).a;
  float ay1 = texture2D(uSampler, vUv - vec2(0.0, uPx.y)).a;
  float ay2 = texture2D(uSampler, vUv + vec2(0.0, uPx.y)).a;
  vec3 n = normalize(vec3((ax1 - ax2) * 1.6, (ay2 - ay1) * 1.6, 0.7));
  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = 0.88 + 0.24 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), 42.0);
  float sheen = 0.045 * sin((vUv.x - vUv.y) * 20.0 + uT * 0.45);
  vec3 col = c.rgb * mix(1.0, diff, a) + (spec * 0.5 + sheen) * a;
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface PaintRenderer {
  draw(t: number, sparks: Spark[], light: boolean): void;
  destroy(): void;
}

function hexOf(color: number, t: number, life: number): number {
  if (color === P.Rainbow) {
    const h = ((t * 2 + life * 10) % 360) / 60;
    const x = Math.round((1 - Math.abs((h % 2) - 1)) * 255);
    const seg: [number, number, number][] = [
      [255, x, 0], [x, 255, 0], [0, 255, x], [0, x, 255], [x, 0, 255], [255, 0, x],
    ];
    const [r, g, b] = seg[Math.min(5, h | 0)];
    return (r << 16) | (g << 8) | b;
  }
  const [r, g, b] = RGB[color] ?? [255, 255, 255];
  return (r << 16) | (g << 8) | b;
}

export async function createPixiRenderer(
  canvas: HTMLCanvasElement,
  gridW: number,
  gridH: number,
  scale: number,
  pixels: Uint8ClampedArray
): Promise<PaintRenderer | null> {
  try {
    const PIXI = await import("pixi.js");
    const W = gridW * scale;
    const H = gridH * scale;
    const app = new PIXI.Application({
      view: canvas,
      width: W,
      height: H,
      antialias: false,
      autoStart: false,
      backgroundAlpha: 1,
      powerPreference: "high-performance",
    });

    // the paint grid as a live buffer texture (raw alpha = paint mask)
    const data = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const baseTexture = PIXI.BaseTexture.fromBuffer(data, gridW, gridH, {
      scaleMode: PIXI.SCALE_MODES.LINEAR,
      alphaMode: PIXI.ALPHA_MODES.NPM,
    });
    const texture = new PIXI.Texture(baseTexture);

    const geometry = new PIXI.Geometry()
      .addAttribute("aVertexPosition", [0, 0, W, 0, W, H, 0, H], 2)
      .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    const shader = PIXI.Shader.from(VERT, FRAG, {
      uSampler: texture,
      uT: 0,
      uPx: [1 / gridW, 1 / gridH],
    });
    const mesh = new PIXI.Mesh(geometry, shader);
    app.stage.addChild(mesh);

    // soft round spark texture
    const g = new PIXI.Graphics();
    g.beginFill(0xffffff, 0.35).drawCircle(8, 8, 8).endFill();
    g.beginFill(0xffffff, 0.6).drawCircle(8, 8, 5).endFill();
    g.beginFill(0xffffff, 1).drawCircle(8, 8, 2.5).endFill();
    const sparkTex = app.renderer.generateTexture(g);
    g.destroy();

    const sparkLayer = new PIXI.Container();
    app.stage.addChild(sparkLayer);
    const pool: InstanceType<typeof PIXI.Sprite>[] = [];

    return {
      draw(t: number, sparks: Spark[], light: boolean) {
        baseTexture.update();
        shader.uniforms.uT = t;

        while (pool.length < sparks.length) {
          const s = new PIXI.Sprite(sparkTex);
          s.anchor.set(0.5);
          sparkLayer.addChild(s);
          pool.push(s);
        }
        const blend = light ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD;
        for (let i = 0; i < pool.length; i++) {
          const sp = pool[i];
          if (i < sparks.length) {
            const k = sparks[i];
            sp.visible = true;
            sp.position.set(k.x * scale, k.y * scale);
            sp.tint = hexOf(k.color, t, k.life);
            sp.alpha = Math.min(1, k.life / 18);
            const sc = 0.35 + Math.min(1, k.life / 45) * 0.55;
            sp.scale.set(sc);
            sp.blendMode = blend;
          } else {
            sp.visible = false;
          }
        }
        app.render();
      },
      destroy() {
        app.destroy(false, { children: true, texture: true, baseTexture: true });
      },
    };
  } catch {
    return null;
  }
}
