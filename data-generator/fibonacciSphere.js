import * as THREE from 'three';
import { DRACOExporter } from 'three/addons/exporters/DRACOExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DracoEncoderModule } from '../draco/draco_encoder.js';

let _drcExporter = null;
let drcExporter = () => {
    if (_drcExporter === null) {
        // DracoEncoderModule is a global variable that needs to be set before using DRACOExporter
        // For some reason three.js does not set it out of the box,
        // so the function had to be manually exported from './draco/draco_encoder.js'
        window.DracoEncoderModule = DracoEncoderModule;
        _drcExporter = new DRACOExporter();
    }
    return _drcExporter;
};

let _gltfExporter = null;
let gltfExporter = () => {
    if (_gltfExporter === null) {
        _gltfExporter = new GLTFExporter();
    }
    return _gltfExporter;
};

export function exportSphereGLTF(radius, numPoints, bin = false) {
    const sphereData = generateSphereData(radius, numPoints);
    const points = makeTHREEPoints(sphereData);
    const exportOpt = {
        binary: bin,
        onlyVisible: false,
    }
    gltfExporter().parse(
        points,
        // On success
        (glb) => {
            downloadBuffer(glb, bin ? 'export.glb' : 'export.gltf');
        }, 
        // On error
        (error) => {
            console.error(error);
        },
        exportOpt
    );
}

export function exportSphereDRC(radius, numPoints) {
    const sphereData = generateSphereData(radius, numPoints);
    const points = makeTHREEPoints(sphereData);
    // Lossless compression
    const exportOpt = {
        decodeSpeed: 0,
        encodeSpeed: 0,
        encoderMethod: DRACOExporter.MESH_SEQUENTIAL_ENCODING,
        quantization: [16, 8, 8, 8, 8],
        exportUvs: false,
        exportNormals: false,
        exportColor: true,
    }
    const drcBuffer = drcExporter().parse(points, exportOpt);
    downloadBuffer(drcBuffer, 'export.drc');
}

export function exportSphereJSON(radius, numPoints) {
    const sphereData = generateSphereData(radius, numPoints);
    const json = JSON.stringify({ sphereData });
    downloadBuffer(new Blob([json], { type: 'application/json' }), 'export.json');
}

function makeTHREEPoints(sphereData) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(sphereData.vertex, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(sphereData.color, 3));
    return new THREE.Points(geometry);
}

function generateSphereData(radius, numPoints) {
    const vertex = new Float32Array(numPoints * 3);
    const color = new Float32Array(numPoints * 3).fill(0);
    const increment = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0, o = 0; i < numPoints; ++i, o += 3) {
        const offset = 2 / numPoints;
        const y = ((i * offset) - 1) + (offset / 2);
        const r = Math.sqrt(1 - Math.pow(y, 2));
        const phi = (i % numPoints) * increment;
        const x = Math.cos(phi) * r;
        const z = Math.sin(phi) * r;
        vertex[o] = x * radius;
        vertex[o + 1] = y * radius;
        vertex[o + 2] = z * radius;
        if (z < 0) {
            // Orange
            color[o] = 1;
            color[o + 1] = 0.569;
            color[o + 2] = 0;
        } else {
            // Blue
            color[o] = 0;
            color[o + 1] = 0;
            color[o + 2] = 1;
        }
    }
    return {
        vertex,
        color
    };
}

function downloadBuffer(buffer, filename) {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};
