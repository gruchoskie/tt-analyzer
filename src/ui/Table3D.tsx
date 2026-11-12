import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NET_OVERHANG_M, NET_HEIGHT_M, TABLE_LENGTH_M, TABLE_WIDTH_M } from '../physics/constants';
import type { Point3 } from '../core/types';

/**
 * Mesa 3D (Three.js) com a trajetória da bola. Referencial da mesa: x =
 * largura, y = comprimento (0 = cabeceira "perto"), z para cima. Arraste para
 * girar, pinça/rolagem para aproximar.
 */
export function Table3D({ trail, cameras = [] }: { trail: Point3[]; cameras?: { p: Point3; label: string }[] }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setTrail: (t: Point3[]) => void; setCams: (c: { p: Point3 }[]) => void } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.textContent = 'Este aparelho não conseguiu abrir a vista 3D (WebGL).';
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
    cam.up.set(0, 0, 1);
    cam.position.set(TABLE_WIDTH_M / 2 - 2.2, -2.6, 2.0);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(TABLE_WIDTH_M / 2, TABLE_LENGTH_M / 2, 0);
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(1, -2, 4);
    scene.add(sun);
    // tampo (topo em z = 0) com linhas brancas
    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE_WIDTH_M, TABLE_LENGTH_M, 0.03), new THREE.MeshStandardMaterial({ color: 0x1d4f8c }));
    top.position.set(TABLE_WIDTH_M / 2, TABLE_LENGTH_M / 2, -0.015);
    scene.add(top);
    const lines = new THREE.LineBasicMaterial({ color: 0xffffff });
    const seg = (pts: [number, number][]) => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, 0.001))), lines));
    seg([[0, 0], [TABLE_WIDTH_M, 0], [TABLE_WIDTH_M, TABLE_LENGTH_M], [0, TABLE_LENGTH_M], [0, 0]]);
    seg([[TABLE_WIDTH_M / 2, 0], [TABLE_WIDTH_M / 2, TABLE_LENGTH_M]]);
    // rede
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE_WIDTH_M + 2 * NET_OVERHANG_M, NET_HEIGHT_M),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    net.rotation.x = Math.PI / 2;
    net.position.set(TABLE_WIDTH_M / 2, TABLE_LENGTH_M / 2, NET_HEIGHT_M / 2);
    scene.add(net);
    // chão (referência)
    const grid = new THREE.GridHelper(8, 16, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(TABLE_WIDTH_M / 2, TABLE_LENGTH_M / 2, -0.76);
    scene.add(grid);

    const trailGeo = new THREE.BufferGeometry();
    const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffb020 }));
    scene.add(trailLine);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x552200 }));
    ball.visible = false;
    scene.add(ball);
    const camMarks = new THREE.Group();
    scene.add(camMarks);

    api.current = {
      setTrail: (t) => {
        trailGeo.setFromPoints(t.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
        const last = t[t.length - 1];
        ball.visible = !!last;
        if (last) ball.position.set(last.x, last.y, last.z);
      },
      setCams: (cs) => {
        camMarks.clear();
        for (const c of cs) {
          const m = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 4), new THREE.MeshStandardMaterial({ color: 0x1aa3b2 }));
          m.position.set(c.p.x, c.p.y, c.p.z);
          m.lookAt(TABLE_WIDTH_M / 2, TABLE_LENGTH_M / 2, 0);
          m.rotateX(Math.PI / 2);
          camMarks.add(m);
        }
      },
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => api.current?.setTrail(trail), [trail]);
  useEffect(() => api.current?.setCams(cameras), [cameras]);

  return <div ref={host} className="table3d" aria-label="Mesa 3D com a trajetória da bola" />;
}
