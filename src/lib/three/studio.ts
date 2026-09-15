import * as THREE from "three";

/*
  three.js plumbing for the hero chest. Everything here is painted at
  runtime — there is no texture, model or HDR file to load.
*/

export const GOLD = 0xe3b95a;
export const GOLD_RGB = "227, 185, 90";
export const VIOLET = 0x9b6dff;
export const VIOLET_RGB = "155, 109, 255";

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/**
 * A studio for gold and lacquer: a black room, one big warm softbox for the
 * key, a thin strip overhead for the long specular line on the lid, a cool
 * fill from the right so the lacquer reads as glossy and not flat, a gold
 * rim low and behind, and a violet kicker far behind so every edge carries
 * the page's glow.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: 0x050308, side: THREE.BackSide })));

  const panel = (w: number, h: number, color: number, intensity: number, x: number, y: number, z: number) => {
    const material = new THREE.MeshBasicMaterial();
    material.color.set(color).multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };

  panel(6, 3.5, 0xfff1d6, 6.5, -4, 6, 4); // warm key softbox, top-left-front
  panel(3, 6, 0xdfe6ff, 2.2, 7, 1, 3); // cool fill, right
  panel(12, 0.4, 0xffffff, 5.5, 0, 8, -1.5); // thin strip overhead → long specular line
  panel(10, 7, 0xffffff, 0.8, 0, 1, 10); // broad soft panel behind the camera
  panel(10, 3, 0xffffff, 0.5, 0, -6, 5); // floor bounce
  panel(12, 1.4, GOLD, 6, -3, -5, -4); // gold rim, below-back-left
  panel(4, 1, GOLD, 2.2, 6, -3, -5); // faint gold kicker, right-back
  panel(6, 6, VIOLET, 2.4, 5, 3, -6); // violet kicker, far right-back

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  disposeScene(scene);
  return target.texture;
}

/** Soft radial glow as a texture, for light spill under and behind the subject. */
export function radialGlowTexture(rgb: string, alpha: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    gradient.addColorStop(0.45, `rgba(${rgb}, ${alpha * 0.32})`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A vertical beam: bright and narrow at the bottom, fading up and out. */
export function beamTexture(rgb: string, alpha: number): THREE.CanvasTexture {
  const w = 128;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const vertical = ctx.createLinearGradient(0, h, 0, 0);
    vertical.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    vertical.addColorStop(0.55, `rgba(${rgb}, ${alpha * 0.35})`);
    vertical.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, w, h);
    // Soften the sides.
    const horizontal = ctx.createLinearGradient(0, 0, w, 0);
    horizontal.addColorStop(0, "rgba(0,0,0,1)");
    horizontal.addColorStop(0.35, "rgba(0,0,0,0)");
    horizontal.addColorStop(0.65, "rgba(0,0,0,0)");
    horizontal.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = horizontal;
    ctx.fillRect(0, 0, w, h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function glowPlane(texture: THREE.Texture, width: number, height = width): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

export function gold(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe0b558,
    metalness: 1,
    roughness: 0.27,
    clearcoat: 0.45,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.25,
  });
}

export function lacquer(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1b1233,
    metalness: 0.18,
    roughness: 0.36,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    envMapIntensity: 0.95,
  });
}

export function satin(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x0f0a1c, metalness: 0.1, roughness: 0.85 });
}

export function gem(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x8f62ff,
    emissive: 0x5a2fd8,
    emissiveIntensity: 0.9,
    metalness: 0,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.4,
  });
}

/** Key / rim / kicker lights. The interior light is the chest's own. */
export function addStudioLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.1));
  const key = new THREE.DirectionalLight(0xfff3dc, 1.3);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const rim = new THREE.PointLight(GOLD, 22, 14, 2);
  rim.position.set(-2.6, 0.4, -2.2);
  scene.add(rim);
  const kicker = new THREE.PointLight(0xffffff, 7, 12, 2);
  kicker.position.set(3.4, 2.6, 2.4);
  scene.add(kicker);
  const cold = new THREE.PointLight(VIOLET, 9, 12, 2);
  cold.position.set(3.2, 1.6, -3);
  scene.add(cold);
}

/** Calls `cb` now and on every size change of `el`. */
export function observeSize(el: HTMLElement, cb: (width: number, height: number) => void): () => void {
  const emit = () => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) cb(rect.width, rect.height);
  };
  const observer = new ResizeObserver(emit);
  observer.observe(el);
  emit();
  window.addEventListener("resize", emit);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", emit);
  };
}

/**
 * requestAnimationFrame loop that only runs while the canvas is on screen and
 * the tab is visible. With `animate = false` it renders a single frame.
 */
export function runLoop(canvas: HTMLCanvasElement, render: (time: number, dt: number) => void, animate: boolean): () => void {
  let raf = 0;
  let running = false;
  let visible = true;
  let last = performance.now();

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    render(now / 1000, dt);
    raf = requestAnimationFrame(frame);
  };

  const sync = () => {
    const should = animate && visible && !document.hidden;
    if (should && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      sync();
    },
    { threshold: 0 },
  );
  observer.observe(canvas);
  document.addEventListener("visibilitychange", sync);

  if (!animate) render(0, 0);
  sync();

  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
    cancelAnimationFrame(raf);
    running = false;
  };
}

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        material.dispose();
      }
    }
  });
}
