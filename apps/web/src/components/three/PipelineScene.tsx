"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

/* The custody scene — one continuous shot driven by scroll progress (0..1):
 *
 *   0.00–0.16  scattered intent gathers into a glowing prompt
 *   0.18–0.32  the prompt travels into the work area
 *   0.30–0.46  an isolated container seals around it (wireframe cube + ring)
 *   0.48–0.70  the agent works — a commit trail draws node by node inside
 *   0.70–0.85  a branch arcs out of the container toward the main line
 *   0.84–0.97  amber merge pulse — the human signs it off
 *   0.86–1.00  the container dissolves; ephemeral by design
 *
 * Everything is computed per frame from a single progress ref, so the scene
 * scrubs forwards and backwards with the scrollbar.
 */

const TEAL = "#00f5d4";
const AMBER = "#f3b24c";
const MERGE = new THREE.Vector3(6.4, 0.9, -0.4);

const NODE_PTS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.85, -0.55, 0.35],
  [-0.3, 0.25, -0.4],
  [0.15, -0.3, 0.45],
  [0.55, 0.45, -0.25],
  [0.9, 0, 0.15],
];

const CAM: ReadonlyArray<{
  t: number;
  pos: readonly [number, number, number];
  look: readonly [number, number, number];
}> = [
  { t: 0.0, pos: [-7.0, 0.5, 6.6], look: [-6.4, 0.1, 0] },
  { t: 0.3, pos: [-1.4, 1.5, 7.6], look: [0, 0, 0] },
  { t: 0.62, pos: [2.4, 1.8, 6.2], look: [0.5, 0.1, 0] },
  { t: 1.0, pos: [4.9, 1.5, 7.5], look: [5.9, 0.8, -0.4] },
];

function ss(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function backOut(x: number): number {
  const c1 = 1.70158;
  const p = x - 1;
  return 1 + (c1 + 1) * p * p * p + c1 * p * p;
}

function makeGlow(rgb: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.3, `rgba(${rgb},0.85)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeRing(rgb: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.strokeStyle = `rgba(${rgb},0.9)`;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

function Story({ p }: { p: { current: number } }) {
  const time = useRef(0);
  const camPos = useRef(new THREE.Vector3(-7, 0.5, 6.6));
  const camLook = useRef(new THREE.Vector3(-6.4, 0.1, 0));

  const glowTeal = useMemo(() => makeGlow("0,245,212"), []);
  const glowAmber = useMemo(() => makeGlow("243,178,76"), []);
  const ringAmber = useMemo(() => makeRing("243,178,76"), []);

  /* swarm — scattered intent → tight cluster around the prompt */
  const swarm = useMemo(() => {
    const N = 2000;
    const scatter = new Float32Array(N * 3);
    const cluster = new Float32Array(N * 3);
    const end = new Float32Array(N * 3);
    const pos = new Float32Array(N * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      scatter[j] = -7 + (Math.random() - 0.5) * 9;
      scatter[j + 1] = (Math.random() - 0.5) * 6;
      scatter[j + 2] = (Math.random() - 0.5) * 5;
      v.randomDirection().multiplyScalar(0.38 * Math.cbrt(Math.random()));
      cluster[j] = v.x;
      cluster[j + 1] = v.y;
      cluster[j + 2] = v.z;
      v.randomDirection().multiplyScalar(2.5 + Math.random() * 4);
      end[j] = v.x;
      end[j + 1] = v.y + 1;
      end[j + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    geo.setAttribute("position", attr);
    return { N, scatter, cluster, end, attr, geo };
  }, []);
  const swarmMat = useRef<THREE.PointsMaterial>(null);

  /* faint dust so the void has depth */
  const dustGeo = useMemo(() => {
    const n = 350;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -11 + Math.random() * 24;
      pos[i * 3 + 1] = -4.5 + Math.random() * 9;
      pos[i * 3 + 2] = -7 + Math.random() * 9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return geo;
  }, []);
  const dustRef = useRef<THREE.Points>(null);

  const core = useRef<THREE.Sprite>(null);
  const coreMat = useRef<THREE.SpriteMaterial>(null);

  /* container */
  const cubeGeo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(2.4, 2.4, 2.4)),
    [],
  );
  const cubeG = useRef<THREE.Group>(null);
  const cubeMatO = useRef<THREE.LineBasicMaterial>(null);
  const cubeMatI = useRef<THREE.LineBasicMaterial>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringMesh = useRef<THREE.Mesh>(null);

  /* commit trail + nodes */
  const trail = useMemo(() => {
    const pts = NODE_PTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: TEAL,
      transparent: true,
      opacity: 0,
    });
    return { obj: new THREE.Line(geo, mat), geo, mat, count: pts.length };
  }, []);
  const nodesG = useRef<THREE.Group>(null);

  /* branch out of the container + the main line it merges into */
  const branch = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(1.25, 0.1, 0.1),
      new THREE.Vector3(3.6, 1.8, 0.4),
      MERGE.clone(),
    );
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: TEAL,
      transparent: true,
      opacity: 0,
    });
    return { obj: new THREE.Line(geo, mat), geo, mat, curve, count: 65 };
  }, []);

  const mainLine = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(3.0, 0.9, -0.4),
      new THREE.Vector3(9.8, 0.9, -0.4),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: "#edf0f0",
      transparent: true,
      opacity: 0,
    });
    return { obj: new THREE.Line(geo, mat), geo, mat };
  }, []);

  const packet = useRef<THREE.Sprite>(null);
  const packetMat = useRef<THREE.SpriteMaterial>(null);
  const pulse = useRef<THREE.Sprite>(null);
  const pulseMat = useRef<THREE.SpriteMaterial>(null);
  const mergeDot = useRef<THREE.Sprite>(null);
  const mergeDotMat = useRef<THREE.SpriteMaterial>(null);

  useEffect(
    () => () => {
      for (const t of [glowTeal, glowAmber, ringAmber]) t.dispose();
      for (const g of [swarm.geo, dustGeo, cubeGeo, trail.geo, branch.geo, mainLine.geo])
        g.dispose();
      for (const m of [trail.mat, branch.mat, mainLine.mat]) m.dispose();
    },
    [glowTeal, glowAmber, ringAmber, swarm, dustGeo, cubeGeo, trail, branch, mainLine],
  );

  useFrame((state, delta) => {
    time.current += delta;
    const t = p.current;
    const tm = time.current;

    const eGather = ss(0.02, 0.16, t);
    const travel = ss(0.18, 0.32, t);
    const px = -7 + 7 * travel;
    const eCubeRaw = ss(0.3, 0.46, t);
    const eWork = ss(0.48, 0.7, t);
    const eBranch = ss(0.7, 0.85, t);
    const ePulse = ss(0.84, 0.97, t);
    const eDissolve = ss(0.86, 1.0, t);
    const alive = 1 - eDissolve;

    /* swarm */
    const a = swarm.attr.array as Float32Array;
    for (let i = 0; i < swarm.N; i++) {
      const j = i * 3;
      const wob = Math.sin(tm * 1.4 + i) * 0.05;
      let x = swarm.scatter[j]!;
      let y = swarm.scatter[j + 1]! + wob;
      let z = swarm.scatter[j + 2]!;
      x += (px + swarm.cluster[j]! - x) * eGather;
      y += (swarm.cluster[j + 1]! + wob * 0.5 - y) * eGather;
      z += (swarm.cluster[j + 2]! - z) * eGather;
      if (eDissolve > 0) {
        x += (swarm.end[j]! - x) * eDissolve;
        y += (swarm.end[j + 1]! - y) * eDissolve;
        z += (swarm.end[j + 2]! - z) * eDissolve;
      }
      a[j] = x;
      a[j + 1] = y;
      a[j + 2] = z;
    }
    swarm.attr.needsUpdate = true;
    if (swarmMat.current) {
      swarmMat.current.opacity =
        (0.3 + 0.55 * eGather) * (1 - ss(0.93, 1, t));
    }

    /* core — the prompt, then the working agent */
    if (core.current && coreMat.current) {
      core.current.position.set(px, 0, 0);
      const work = eWork * (1 - eWork) * 4; // 0→1→0 hump while working
      const s =
        (0.6 + 1.2 * eGather) *
        (1 + 0.1 * Math.sin(tm * 5) + 0.12 * work * Math.sin(tm * 21));
      core.current.scale.setScalar(s);
      coreMat.current.opacity = eGather * alive;
    }

    /* container */
    if (cubeG.current) {
      const sc = Math.max(0.001, backOut(eCubeRaw) * (1 - 0.3 * eDissolve));
      cubeG.current.scale.setScalar(sc);
      cubeG.current.rotation.y = (1 - eCubeRaw) * 1.2 + tm * 0.07;
      cubeG.current.rotation.x = (1 - eCubeRaw) * 0.5;
      cubeG.current.visible = eCubeRaw > 0.001;
    }
    if (cubeMatO.current) cubeMatO.current.opacity = 0.85 * eCubeRaw * alive;
    if (cubeMatI.current) cubeMatI.current.opacity = 0.18 * eCubeRaw * alive;
    if (ringMat.current) ringMat.current.opacity = 0.4 * eCubeRaw * alive;
    if (ringMesh.current) ringMesh.current.rotation.z = -tm * 0.18;

    /* commit trail */
    trail.geo.setDrawRange(0, Math.round(eWork * trail.count));
    trail.mat.opacity = Math.min(1, eWork * 8) * 0.9 * alive;
    if (nodesG.current) {
      nodesG.current.children.forEach((node, i) => {
        const k = Math.min(1, Math.max(0, eWork * trail.count - i));
        node.scale.setScalar(Math.max(0.001, backOut(k)));
        node.visible = k > 0.001 && alive > 0.05;
      });
    }

    /* branch + merge */
    branch.geo.setDrawRange(0, Math.floor(eBranch * branch.count));
    branch.mat.opacity = Math.min(1, eBranch * 6) * 0.9;
    mainLine.mat.opacity = 0.1 + 0.3 * eBranch;
    if (packet.current && packetMat.current) {
      branch.curve.getPoint(Math.min(eBranch, 1), packet.current.position);
      packet.current.scale.setScalar(0.45);
      packetMat.current.opacity =
        eBranch > 0 && eBranch < 1 ? Math.sin(Math.PI * eBranch) : 0;
    }
    if (pulse.current && pulseMat.current) {
      pulse.current.scale.setScalar(0.3 + 3.0 * ePulse);
      pulseMat.current.opacity = Math.sin(Math.PI * ePulse) * 0.9;
    }
    if (mergeDot.current && mergeDotMat.current) {
      mergeDot.current.scale.setScalar(0.55 + 0.06 * Math.sin(tm * 4));
      mergeDotMat.current.opacity = ss(0.84, 0.92, t);
    }

    if (dustRef.current) dustRef.current.rotation.y = tm * 0.01;

    /* camera — keyframed dolly + pointer parallax, critically damped */
    let seg = 0;
    for (let i = 0; i < CAM.length - 1; i++) {
      if (t >= CAM[i]!.t) seg = i;
    }
    const k0 = CAM[seg]!;
    const k1 = CAM[Math.min(seg + 1, CAM.length - 1)]!;
    const span = Math.max(1e-5, k1.t - k0.t);
    const local = ss(0, 1, (t - k0.t) / span);
    const target = new THREE.Vector3(
      k0.pos[0] + (k1.pos[0] - k0.pos[0]) * local + state.pointer.x * 0.45,
      k0.pos[1] + (k1.pos[1] - k0.pos[1]) * local + state.pointer.y * 0.25,
      k0.pos[2] + (k1.pos[2] - k0.pos[2]) * local,
    );
    const look = new THREE.Vector3(
      k0.look[0] + (k1.look[0] - k0.look[0]) * local,
      k0.look[1] + (k1.look[1] - k0.look[1]) * local,
      k0.look[2] + (k1.look[2] - k0.look[2]) * local,
    );
    const damp = 1 - Math.exp(-7 * delta);
    camPos.current.lerp(target, damp);
    camLook.current.lerp(look, damp);
    state.camera.position.copy(camPos.current);
    state.camera.lookAt(camLook.current);
  });

  return (
    <group>
      <points geometry={dustGeo} ref={dustRef}>
        <pointsMaterial
          color={TEAL}
          size={0.03}
          sizeAttenuation
          transparent
          opacity={0.16}
          depthWrite={false}
        />
      </points>

      <points geometry={swarm.geo}>
        <pointsMaterial
          ref={swarmMat}
          color={TEAL}
          size={0.055}
          sizeAttenuation
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <sprite ref={core} position={[-7, 0, 0]}>
        <spriteMaterial
          ref={coreMat}
          map={glowTeal}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      <group ref={cubeG} visible={false}>
        <lineSegments geometry={cubeGeo}>
          <lineBasicMaterial ref={cubeMatO} color={TEAL} transparent opacity={0} />
        </lineSegments>
        <lineSegments geometry={cubeGeo} scale={1.08}>
          <lineBasicMaterial ref={cubeMatI} color={TEAL} transparent opacity={0} />
        </lineSegments>
        <mesh ref={ringMesh} rotation={[1.35, 0, 0]}>
          <torusGeometry args={[2.2, 0.012, 8, 96]} />
          <meshBasicMaterial ref={ringMat} color={TEAL} transparent opacity={0} />
        </mesh>
        <primitive object={trail.obj} />
        <group ref={nodesG}>
          {NODE_PTS.map(([x, y, z], i) => (
            <mesh key={i} position={[x, y, z]} scale={0.001}>
              <sphereGeometry args={[0.06, 12, 12]} />
              <meshBasicMaterial color={i === NODE_PTS.length - 1 ? AMBER : TEAL} />
            </mesh>
          ))}
        </group>
      </group>

      <primitive object={branch.obj} />
      <primitive object={mainLine.obj} />

      <sprite ref={packet}>
        <spriteMaterial
          ref={packetMat}
          map={glowTeal}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      <sprite ref={pulse} position={MERGE}>
        <spriteMaterial
          ref={pulseMat}
          map={ringAmber}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      <sprite ref={mergeDot} position={MERGE}>
        <spriteMaterial
          ref={mergeDotMat}
          map={glowAmber}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  );
}

/** Pinned custody scene canvas. `progress` is scrubbed by the wrapper. */
export default function PipelineScene({
  progress,
  active,
}: {
  progress: { current: number };
  active: boolean;
}) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={[1, 2]}
      camera={{ position: [-7, 0.5, 6.6], fov: 42, near: 0.1, far: 80 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <Story p={progress} />
    </Canvas>
  );
}
