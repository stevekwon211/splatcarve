import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

interface ShaderHookPayload {
  uniforms: Record<string, unknown>;
  vertexShader: string;
  fragmentShader: string;
}

/**
 * Wave C+.1 recon spike. Hooks `onBeforeCompile` on `SparkRenderer.material`
 * (the `THREE.ShaderMaterial` confirmed by `SparkRenderer.d.ts`) and dumps the
 * actual GLSL Three.js hands to the WebGL compiler.
 *
 * SparkRenderer extends THREE.Mesh and owns the splat draw call's
 * ShaderMaterial. The SplatMesh is only a data generator, not the rendering
 * mesh — confirmed by reading dist/types/SparkRenderer.d.ts. We hook the
 * Spark material directly.
 *
 * Also dumps any material reachable via `mesh.traverse` so we can spot
 * mistakes if the material moves between Spark versions.
 *
 * Gated behind `?spike=1` in `main.ts`. Kept around so future Spark upgrades
 * can re-verify the shader-injection anchors haven't moved.
 */
export function runShaderHookSpike(spark: SparkRenderer, mesh: SplatMesh): void {
  console.group('[spike] shader hook recon');
  let hookCount = 0;

  const hookOne = (mat: unknown, label: string): void => {
    if (!mat || typeof mat !== 'object') return;
    const matAny = mat as {
      type?: string;
      onBeforeCompile?: (shader: ShaderHookPayload) => void;
      needsUpdate?: boolean;
    };
    console.info(`[spike] candidate: ${label} type=${matAny.type ?? '<unknown>'}`);
    matAny.onBeforeCompile = (shader): void => {
      hookCount++;
      console.group(`[spike] onBeforeCompile #${hookCount} (${label})`);
      console.info('uniforms keys:', Object.keys(shader.uniforms));
      console.info(`vertex length=${shader.vertexShader.length} chars`);
      console.info(`fragment length=${shader.fragmentShader.length} chars`);
      console.info('--- VERTEX SHADER (full) ---');
      console.log(shader.vertexShader);
      console.info('--- FRAGMENT SHADER (full) ---');
      console.log(shader.fragmentShader);
      console.groupEnd();
    };
    matAny.needsUpdate = true;
  };

  hookOne((spark as unknown as { material: unknown }).material, 'SparkRenderer.material');
  mesh.traverse((obj) => {
    const anyObj = obj as unknown as { material?: unknown };
    if (!anyObj.material) return;
    hookOne(anyObj.material, `SplatMesh tree / ${obj.constructor.name}`);
  });

  setTimeout(() => {
    console.info(
      `[spike] post-tick: ${
        hookCount === 0 ? 'STILL NO COMPILES — hook may be bypassed' : `${hookCount} compiles fired`
      }`,
    );
  }, 1500);

  console.info('[spike] hooks installed; first render pass should trigger them');
  console.groupEnd();
}
