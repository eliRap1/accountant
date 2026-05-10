"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Sparkles, Environment } from "@react-three/drei";
import { useRef, Suspense } from "react";
import * as THREE from "three";

function WireKnot() {
  const mesh = useRef<THREE.Mesh>(null);
  const group = useRef<THREE.Group>(null);
  const { mouse, viewport } = useThree();

  useFrame((_, delta) => {
    if (!mesh.current || !group.current) return;
    mesh.current.rotation.x += delta * 0.12;
    mesh.current.rotation.y += delta * 0.18;

    const targetX = mouse.y * 0.35;
    const targetY = mouse.x * 0.55;
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, targetX, 0.06);
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, targetY, 0.06);

    const px = (mouse.x * viewport.width) * 0.04;
    const py = (mouse.y * viewport.height) * 0.04;
    group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, px, 0.08);
    group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, py, 0.08);
  });

  return (
    <group ref={group}>
      <Float speed={1.4} rotationIntensity={0.3} floatIntensity={1.1}>
        {/* Glow core */}
        <mesh>
          <icosahedronGeometry args={[1.05, 1]} />
          <meshBasicMaterial color="#064e3b" transparent opacity={0.35} />
        </mesh>
        {/* Wire knot */}
        <mesh ref={mesh} scale={1.55}>
          <torusKnotGeometry args={[1, 0.32, 220, 36, 2, 3]} />
          <meshBasicMaterial color="#10b981" wireframe />
        </mesh>
        {/* Outer ring */}
        <mesh rotation={[Math.PI / 3, 0, 0]} scale={2.4}>
          <torusGeometry args={[1, 0.005, 8, 96]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.45} />
        </mesh>
        <mesh rotation={[0, Math.PI / 3, Math.PI / 4]} scale={2.7}>
          <torusGeometry args={[1, 0.004, 8, 96]} />
          <meshBasicMaterial color="#6ee7b7" transparent opacity={0.25} />
        </mesh>
      </Float>
    </group>
  );
}

const N = 9;
const GRID_ITEMS: { x: number; z: number }[] = [];
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    GRID_ITEMS.push({ x: (i - (N - 1) / 2) * 0.55, z: (j - (N - 1) / 2) * 0.55 });
  }
}

function DataGrid() {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.15) * 0.05;
  });
  return (
    <group ref={ref} position={[0, -1.8, 0]} rotation={[-Math.PI / 2.2, 0, 0]}>
      {GRID_ITEMS.map((p, idx) => (
        <Bar key={idx} {...p} idx={idx} />
      ))}
    </group>
  );
}

function Bar({ x, z, idx }: { x: number; z: number; idx: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const h = 0.15 + (Math.sin(t * 0.9 + idx * 0.35) * 0.5 + 0.5) * 1.2;
    ref.current.scale.y = h;
    ref.current.position.y = h / 2;
  });
  return (
    <mesh ref={ref} position={[x, 0, z]}>
      <boxGeometry args={[0.18, 1, 0.18]} />
      <meshBasicMaterial color="#10b981" transparent opacity={0.55} />
    </mesh>
  );
}

export default function HeroScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 5.2], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      className="!absolute inset-0"
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <pointLight position={[6, 6, 6]} intensity={1.2} color="#10b981" />
        <pointLight position={[-6, -3, -4]} intensity={0.6} color="#0ea5e9" />
        <WireKnot />
        <DataGrid />
        <Sparkles count={120} scale={[8, 5, 4]} size={2} speed={0.3} color="#34d399" opacity={0.7} />
        <Environment preset="city" />
      </Suspense>
    </Canvas>
  );
}
