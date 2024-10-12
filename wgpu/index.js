import { loadDRC } from '../loading.js';
import { mat4 } from 'wgpu-matrix';
import { GeometryRenderer, GeometryRendererMode } from './renderers/GeometryRenderer.js';
import { ComputeRenderer } from './renderers/ComputeRenderer.js';

const pipelineOptions = Object.freeze({
    POINTS: 'points',
    QUADS: 'quads',
    COMPUTE: 'compute',
});

function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const loadPath = params.get('loadPath');
    const pipeline = params.get('pipeline');
    const repaint = parseInt(params.get('repaint')) || 1;
    const pointSize = parseInt(params.get('size')) || 1;
    return {
        loadPath,
        pipeline,
        repaint,
        pointSize
    };
}

class RollingAverage {
    #total = 0;
    #samples = [];
    #cursor = 0;
    #numSamples;
    constructor(numSamples = 30) {
        this.#numSamples = numSamples;
    }
    addSample(v) {
        this.#total += v - (this.#samples[this.#cursor] || 0);
        this.#samples[this.#cursor] = v;
        this.#cursor = (this.#cursor + 1) % this.#numSamples;
    }
    get() {
        return this.#total / this.#samples.length;
    }
}

async function main() {

    const { pipeline, pointSize, repaint, loadPath } = parseQueryParams();

    const canvas = document.querySelector('canvas');

    // Create renderer
    let _rend = null;
    if (pipeline === pipelineOptions.POINTS) {
        _rend = new GeometryRenderer(canvas, {
            mode: GeometryRendererMode.POINTS,
        });
    } else if (pipeline === pipelineOptions.QUADS) {
        _rend = new GeometryRenderer(canvas, {
            mode: GeometryRendererMode.QUADS,
        });
    } else if (pipeline === pipelineOptions.COMPUTE) {
        _rend = new ComputeRenderer(canvas);
    } else {
        throw new Error(`Invalid pipeline: ${pipeline}`);
    }
    const renderer = _rend;
    await renderer.init();
    
    // Load model
    const pointcloudData = await loadDRC(loadPath);
    renderer.setModel(pointcloudData);

    // Performance metrics
    const fpsAverage = new RollingAverage();
    const jsAverage = new RollingAverage();
    const infoElem = document.querySelector('#info');

    let then = 0;

    const minScale = 0.3;
    const maxScale = 2;
    const scaleSpeed = 0.5;
    let scale = 1;
    let scaleDirection = 1;

    // Set point size
    renderer.setPointSize?.(pointSize);
    renderer.setRepaint(repaint);

    function render(now) {
        now *= 0.001;  // convert to seconds
        const deltaTime = now - then;
        then = now;

        const startTime = performance.now();
        
        // Ping pong animation for scale
        scale += scaleDirection * scaleSpeed * deltaTime;
        if (scale > maxScale) {
            scale = maxScale;
            scaleDirection = -1;
        } else if (scale < minScale) {
            scale = minScale;
            scaleDirection = 1;
        }

        // Set MVP matrix
        const fov = 90 * Math.PI / 180;
        const aspect = canvas.clientWidth / canvas.clientHeight;
        const projection = mat4.perspective(fov, aspect, 0.1, null);
        const view = mat4.lookAt(
            [0, 0, 1.5],  // position
            [0, 0, 0],    // target
            [0, 1, 0],    // up
        );
        const viewProjection = mat4.multiply(projection, view);
        const rotationY = mat4.rotationY(now);
        const scaleMat = mat4.uniformScaling(scale);
        const modelMat = mat4.multiply(scaleMat, rotationY);

        const mvp = mat4.multiply(viewProjection, modelMat);

        renderer.setMVP(mvp);
        
        renderer.render();

        const jsTime = performance.now() - startTime;

        fpsAverage.addSample(1 / deltaTime);
        jsAverage.addSample(jsTime);

        infoElem.textContent = `\
            fps: ${fpsAverage.get().toFixed(1)}
            js: ${jsAverage.get().toFixed(2)}ms
            `;
        
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

main();
