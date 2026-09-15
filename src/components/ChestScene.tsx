"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { addStudioLights, createRenderer, createStudioEnvironment, disposeScene, observeSize, runLoop, supportsWebGL } from "@/lib/three/studio";
import { buildChest } from "@/lib/three/chest";
import { ChestMark } from "@/components/ChestMark";
import { useMounted } from "@/components/ConnectButton";

let webglSupport: boolean | null = null;
function webgl(): boolean {
  if (webglSupport === null) webglSupport = supportsWebGL();
  return webglSupport;
}

type Props = {
  /** Target openness: a boolean, or a fraction for a chest that is partly unlocked. */
  open: boolean | number;
  /** Clicking the canvas toggles the lid. */
  interactive?: boolean;
  onToggle?: (open: boolean) => void;
  /** Camera framing: the hero sits lower and larger; a card is centred and small. */
  framing?: "hero" | "card";
  className?: string;
};

/**
 * The hero object: a lacquered chest with gold bands, lit by a painted
 * studio environment, whose lid swings back on `open`. The interior light,
 * the beam and the gem all follow the lid. Falls back to the flat mark
 * where WebGL is unavailable.
 */
export function ChestScene({ open, interactive = false, onToggle, framing = "hero", className = "" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef(typeof open === "number" ? open : open ? 1 : 0);
  const toggleRef = useRef(onToggle);
  // null during SSR and hydration; decided once the client owns the tree.
  const mounted = useMounted();
  const supported = mounted ? webgl() : null;

  useEffect(() => {
    toggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    targetRef.current = typeof open === "number" ? Math.min(1, Math.max(0, open)) : open ? 1 : 0;
  }, [open]);

  useEffect(() => {
    if (!supported) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = createRenderer(canvas);
    const environment = createStudioEnvironment(renderer);

    const scene = new THREE.Scene();
    scene.environment = environment;

    const hero = framing === "hero";
    const camera = new THREE.PerspectiveCamera(hero ? 26 : 30, 1, 0.1, 40);
    camera.position.set(0, hero ? 2.3 : 2.0, hero ? 8.4 : 7.4);
    camera.lookAt(0, hero ? 1.0 : 0.85, 0);

    addStudioLights(scene);

    const rig = buildChest();
    const REST = { x: 0.02, y: -0.5 };
    rig.group.rotation.set(REST.x, REST.y, 0);
    scene.add(rig.group);

    // Pointer parallax, normalised to the viewport.
    const pointer = new THREE.Vector2();
    const onMove = (event: PointerEvent) => {
      pointer.set((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const onClick = () => {
      if (!interactive) return;
      const next = targetRef.current < 0.5 ? 1 : 0;
      targetRef.current = next;
      toggleRef.current?.(next === 1);
    };
    canvas.addEventListener("click", onClick);

    const stopResize = observeSize(host, (w, h) => {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });

    // A spring on the lid: a little overshoot on the way open, a firm close.
    let x = reduce ? targetRef.current : 0;
    let v = 0;
    let elapsed = 0;
    rig.setOpen(x);
    const stopLoop = runLoop(
      canvas,
      (time, dt) => {
        elapsed += dt;
        const target = targetRef.current;
        if (reduce) {
          x = target;
        } else {
          const k = target > x ? 34 : 48;
          const damping = target > x ? 6.5 : 10;
          v += (target - x) * k * dt - v * damping * dt;
          x += v * dt;
          if (Math.abs(target - x) < 0.0005 && Math.abs(v) < 0.001) {
            x = target;
            v = 0;
          }
        }
        rig.setOpen(x);
        rig.tick(time);
        const bob = reduce ? 0 : Math.sin(elapsed * 0.8) * 0.04;
        rig.group.position.y = bob - 0.35;
        const targetX = REST.x + (reduce ? 0 : -pointer.y * 0.1);
        const targetY = REST.y + (reduce ? 0 : pointer.x * 0.28 + Math.sin(elapsed * 0.3) * 0.05);
        rig.group.rotation.x += (targetX - rig.group.rotation.x) * Math.min(1, dt * 3);
        rig.group.rotation.y += (targetY - rig.group.rotation.y) * Math.min(1, dt * 3);
        renderer.render(scene, camera);
      },
      true,
    );

    return () => {
      stopLoop();
      stopResize();
      window.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("click", onClick);
      disposeScene(scene);
      environment.dispose();
      renderer.dispose();
    };
  }, [supported, framing, interactive]);

  return (
    <div ref={hostRef} className={`relative ${className}`} aria-hidden="true">
      {supported === false ? (
        <div className="flex h-full w-full items-center justify-center">
          <ChestMark className="h-[60%] w-auto" open={typeof open === "number" ? open > 0.5 : open} />
        </div>
      ) : (
        <canvas ref={canvasRef} className={`block h-full w-full ${interactive ? "cursor-pointer" : ""}`} />
      )}
    </div>
  );
}
