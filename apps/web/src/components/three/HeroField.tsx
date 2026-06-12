"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/* The manifest grid — a ruled field of ~9k mono points that breathes like a
 * signal plot. The pointer presses a ripple into it; scrolling past the hero
 * scatters the field like a ledger page being torn off. All displacement is
 * in the vertex shader, so the CPU cost per frame is ~zero. */

const COLS = 160;
const ROWS = 58;
const W = 30;
const D = 13;

const vertex = /* glsl */ `
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uScroll;
  uniform float uPx;
  attribute float aRand;
  varying float vAlpha;
  varying float vMix;

  void main() {
    vec3 p = position;
    float t = uTime * 0.55;

    float w1 = sin(p.x * 0.5 + t) * cos(p.z * 0.42 + t * 0.85);
    float w2 = sin(p.x * 0.16 - t * 0.7 + aRand * 6.2831) * 0.6;
    p.y += w1 * 0.34 + w2 * 0.22;

    float d = distance(p.xz, uPointer);
    float push = smoothstep(2.6, 0.0, d);
    p.y += push * 1.1;

    // tear-off: each point departs on its own vector as the hero scrolls out
    float s = uScroll * uScroll;
    p += vec3(aRand - 0.5, aRand * 1.6, fract(aRand * 7.31) - 0.5) * s * 9.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.2 + push * 3.4 + max(w1, 0.0) * 1.5) * uPx * (10.0 / -mv.z);

    float depth = smoothstep(-22.0, -4.0, mv.z);
    vAlpha = (0.2 + push * 0.7 + max(w1, 0.0) * 0.34) * depth * (1.0 - s * 0.9);
    vMix = step(0.962, aRand);
  }
`;

const fragment = /* glsl */ `
  precision mediump float;
  uniform vec3 uColA;
  uniform vec3 uColB;
  varying float vAlpha;
  varying float vMix;

  void main() {
    float m = smoothstep(0.5, 0.12, length(gl_PointCoord - 0.5));
    if (m < 0.01) discard;
    gl_FragColor = vec4(mix(uColA, uColB, vMix), m * vAlpha);
  }
`;

function Field() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const { camera, gl } = useThree();
  const target = useRef(new THREE.Vector2(0, 99)); // park off-grid until pointer moves
  const eased = useRef(new THREE.Vector2(0, 99));
  const scroll = useRef(0);

  const { positions, rands } = useMemo(() => {
    const n = COLS * ROWS;
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        pos[i * 3] = (c / (COLS - 1) - 0.5) * W;
        pos[i * 3 + 1] = 0;
        pos[i * 3 + 2] = (r / (ROWS - 1) - 0.5) * D - 1.5;
        rnd[i] = Math.random();
        i++;
      }
    }
    return { positions: pos, rands: rnd };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 99) },
      uScroll: { value: 0 },
      uPx: { value: 1 },
      uColA: { value: new THREE.Color("#00f5d4") },
      uColB: { value: new THREE.Color("#f3b24c") },
    }),
    [],
  );

  // pointer → world position on the y=0 plane, via the hero's own canvas
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) target.current.set(hit.x, hit.z);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [camera, gl]);

  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: "#hero",
      start: "top top",
      end: "bottom top",
      onUpdate: (self) => {
        scroll.current = self.progress;
      },
    });
    return () => st.kill();
  }, []);

  useFrame((state, delta) => {
    const m = mat.current;
    if (!m) return;
    m.uniforms.uTime!.value += delta;
    m.uniforms.uPx!.value = state.gl.getPixelRatio();
    m.uniforms.uScroll!.value = scroll.current;
    eased.current.lerp(target.current, 0.08);
    (m.uniforms.uPointer!.value as THREE.Vector2).copy(eased.current);
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aRand" args={[rands, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={mat}
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Hero backdrop canvas. Pauses rendering once the hero leaves the viewport. */
export default function HeroField() {
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setActive(entry?.isIntersecting ?? true),
      { rootMargin: "15%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0 animate-[heroFieldIn_1.6s_ease_both]">
      <Canvas
        frameloop={active ? "always" : "never"}
        dpr={[1, 1.75]}
        camera={{ position: [0, 2.7, 7.2], fov: 50, near: 0.1, far: 60 }}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ camera }) => camera.lookAt(0, -0.4, -2)}
      >
        <Field />
      </Canvas>
    </div>
  );
}
