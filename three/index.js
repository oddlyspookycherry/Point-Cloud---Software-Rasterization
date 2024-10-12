import * as THREE from 'three';
import { loadDRC } from '../loading.js';
import Stats from 'three/addons/libs/stats.module.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';

const width = 1920;
const height = 1080;

function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const useWebGPU = params.has('useWebGPU');
    const loadPath = params.get('loadPath');
    const repaint = parseInt(params.get('repaint')) || 1;
    const pointSize = parseInt(params.get('pointSize')) || 0.01;
    return {
        useWebGPU,
        loadPath,
        repaint,
        pointSize
    };
}

async function main() {

    const { useWebGPU, pointSize, repaint, loadPath } = parseQueryParams();

    if (useWebGPU && WebGPU.isAvailable() === false) {

        document.body.appendChild(WebGPU.getErrorMessage());

        throw new Error('No WebGPU support');

    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0);
    const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 1000);

    const renderer = useWebGPU ? new WebGPURenderer(): new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    // 

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    //

    const geometry = await loadDRC(loadPath);
    const material = new THREE.PointsMaterial({ size: pointSize, vertexColors: true });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    camera.position.z = 5;

    let scaleDireciton = 1;
    const minScale = 0.3;
    const maxScale = 2.3;
    let scale = 1;

    const renderFn = useWebGPU ? renderer.renderAsync.bind(renderer) : renderer.render.bind(renderer);

    function animate() {
        points.rotation.x += 0.01;
        points.rotation.y += 0.01;

        scale += 0.01 * scaleDireciton;
        if (scale > maxScale) {
            scaleDireciton = -1;
        } else if (scale < minScale) {
            scaleDireciton = 1;
        }

        // Apply the scale to the points
        points.scale.set(scale, scale, scale);
        for (let i = 0; i < repaint; i++) {
            renderFn(scene, camera);
        }
        stats.update();
    };

    renderer.setAnimationLoop(animate);
    animate();
}

main()