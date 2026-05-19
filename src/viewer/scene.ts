import { SparkControls, SparkRenderer } from '@sparkjsdev/spark';
import * as THREE from 'three';

export interface Viewer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  spark: SparkRenderer;
  controls: SparkControls;
  canvas: HTMLCanvasElement;
  dispose(): void;
}

export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0c);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.01,
    100,
  );
  camera.position.set(0, 0, -2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  const controls = new SparkControls({ canvas });
  controls.fpsMovement.enable = false;

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);

  return {
    scene,
    camera,
    renderer,
    spark,
    controls,
    canvas,
    dispose: (): void => {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
