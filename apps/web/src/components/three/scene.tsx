"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Line, Stars } from "@react-three/drei";
import * as THREE from "three";
import { scrollFx } from "@/lib/scrollFx";

/* ── Graph: repo → branches → commits → PR ────────────────────────────────
 * Each node ignites when page scroll passes its `threshold`, so scrolling
 * the page literally walks the task from repo to merged PR. */
type NodeDef = {
  id: string;
  pos: [number, number, number];
  color: string;
  size: number;
  /** Scroll progress (0..1) at which this node lights up. */
  threshold: number;
};

const NODES: NodeDef[] = [
  { id: "repo", pos: [-3.4, 0.2, 0], color: "#6366f1", size: 0.55, threshold: 0.06 },
  { id: "b1", pos: [-1.2, 1.5, -0.6], color: "#8b5cf6", size: 0.32, threshold: 0.24 },
  { id: "b2", pos: [-1.0, -1.3, 0.5], color: "#22d3ee", size: 0.32, threshold: 0.28 },
  { id: "c1", pos: [1.0, 1.7, 0.3], color: "#22d3ee", size: 0.24, threshold: 0.44 },
  { id: "c2", pos: [1.2, 0.1, -0.8], color: "#8b5cf6", size: 0.24, threshold: 0.5 },
  { id: "c3", pos: [0.9, -1.6, 0.6], color: "#5865f2", size: 0.24, threshold: 0.56 },
  { id: "pr", pos: [3.4, 0.3, 0], color: "#ec4899", size: 0.5, threshold: 0.72 },
];

const EDGES: [string, string][] = [
  ["repo", "b1"],
  ["repo", "b2"],
  ["b1", "c1"],
  ["b1", "c2"],
  ["b2", "c2"],
  ["b2", "c3"],
  ["c1", "pr"],
  ["c2", "pr"],
  ["c3", "pr"],
];

const byId = (id: string) => NODES.find((n) => n.id === id)!;

/* ── Scroll-scrubbed camera path (hero wide → fly along graph → pull back) ── */
const CAM_PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.2, 9),
  new THREE.Vector3(-3.2, 1.4, 5.2),
  new THREE.Vector3(-0.8, 1.9, 4.6),
  new THREE.Vector3(1.3, -0.7, 4.2),
  new THREE.Vector3(3.6, 0.9, 4.6),
  new THREE.Vector3(0, 0.4, 9.6),
]);
const LOOK_PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(-3.4, 0.2, 0),
  new THREE.Vector3(-1.1, 0.1, -0.1),
  new THREE.Vector3(1.0, 0, 0),
  new THREE.Vector3(3.4, 0.3, 0),
  new THREE.Vector3(0, 0, 0),
]);
const CAM_POS = new THREE.Vector3();
const CAM_LOOK = new THREE.Vector3();

const { smoothstep, damp } = THREE.MathUtils;

function CameraRig() {
  const sm = useRef({ p: 0, px: 0, py: 0 });
  useFrame((state, delta) => {
    const s = sm.current;
    s.p = damp(s.p, scrollFx.progress, 2.4, delta);
    s.px = damp(s.px, scrollFx.pointerX, 3, delta);
    s.py = damp(s.py, scrollFx.pointerY, 3, delta);

    CAM_PATH.getPoint(s.p, CAM_POS);
    LOOK_PATH.getPoint(s.p, CAM_LOOK);
    state.camera.position.set(
      CAM_POS.x + s.px * 0.7,
      CAM_POS.y + s.py * 0.45,
      CAM_POS.z,
    );
    state.camera.lookAt(CAM_LOOK);
  });
  return null;
}

/* ── A node: emissive core + wireframe shell, ignites on scroll ───────────── */
function Node({ def }: { def: NodeDef }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const grp = useRef<THREE.Group>(null);

  useFrame((state) => {
    const p = scrollFx.progress;
    const a = smoothstep(p, def.threshold - 0.08, def.threshold + 0.08);
    // PR node flares as the story "merges" near the end of the page
    const flare = def.id === "pr" ? smoothstep(p, 0.86, 0.97) : 0;
    const pulse =
      a * 0.05 * Math.sin(state.clock.elapsedTime * 2.2 + def.pos[0] * 3);

    if (mat.current) mat.current.emissiveIntensity = 0.3 + a * 1.5 + flare * 2.5;
    if (light.current) light.current.intensity = 0.4 + a * 3.5 + flare * 8;
    grp.current?.scale.setScalar(0.85 + a * 0.2 + pulse + flare * 0.18);
  });

  return (
    <Float speed={1.4} rotationIntensity={0.5} floatIntensity={0.3}>
      <group ref={grp} position={def.pos}>
        <mesh>
          <icosahedronGeometry args={[def.size, 1]} />
          <meshStandardMaterial
            ref={mat}
            color={def.color}
            emissive={def.color}
            emissiveIntensity={0.3}
            roughness={0.25}
            metalness={0.1}
            toneMapped={false}
          />
        </mesh>
        <mesh scale={1.35}>
          <icosahedronGeometry args={[def.size, 1]} />
          <meshBasicMaterial
            color={def.color}
            wireframe
            transparent
            opacity={0.22}
            toneMapped={false}
          />
        </mesh>
        <pointLight ref={light} color={def.color} intensity={0.4} distance={3.5} />
      </group>
    </Float>
  );
}

/* ── Edge: draws in (opacity ramps) between its endpoints' thresholds ─────── */
function Edge({ from, to, offset }: { from: string; to: string; offset: number }) {
  const a = byId(from);
  const b = byId(to);
  const points = useMemo(() => {
    const start = new THREE.Vector3(...a.pos);
    const end = new THREE.Vector3(...b.pos);
    const mid = start.clone().lerp(end, 0.5);
    mid.y += 0.5;
    mid.z += 0.3;
    return new THREE.QuadraticBezierCurve3(start, mid, end).getPoints(40);
  }, [a, b]);

  // drei <Line> renders a Line2 whose material is a LineMaterial.
  const ref = useRef<{
    material?: { dashOffset?: number; opacity?: number };
  } | null>(null);

  useFrame((state) => {
    const mat = ref.current?.material;
    if (!mat) return;
    const p = scrollFx.progress;
    const reveal = smoothstep(p, a.threshold, b.threshold + 0.04);
    if (typeof mat.opacity === "number") mat.opacity = 0.08 + reveal * 0.5;
    if (typeof mat.dashOffset === "number") {
      mat.dashOffset = -(
        (state.clock.elapsedTime * (0.15 + reveal * 0.7) + offset) %
        1000
      );
    }
  });

  return (
    <Line
      ref={ref as never}
      points={points}
      color="#8b5cf6"
      lineWidth={1.1}
      transparent
      opacity={0.08}
      dashed
      dashSize={0.18}
      gapSize={0.12}
      toneMapped={false}
    />
  );
}

function Graph() {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    // camera does the travel; the graph just sways
    g.rotation.y = Math.sin(state.clock.elapsedTime * 0.12) * 0.08;
  });

  return (
    <group ref={group}>
      {EDGES.map(([f, t], i) => (
        <Edge key={`${f}-${t}`} from={f} to={t} offset={i * 0.3} />
      ))}
      {NODES.map((n) => (
        <Node key={n.id} def={n} />
      ))}
    </group>
  );
}

export default function Scene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.2, 9], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <fog attach="fog" args={["#06060d", 9, 17]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 5, 5]} intensity={0.6} />
      <Stars radius={40} depth={30} count={900} factor={3} saturation={0} fade speed={0.6} />
      <CameraRig />
      <Graph />
    </Canvas>
  );
}
