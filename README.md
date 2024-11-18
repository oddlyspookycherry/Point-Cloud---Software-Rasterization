# Point Cloud: Software Rasterization

## Overview

<img width="617" alt="image" src="https://github.com/user-attachments/assets/e9a2a0ac-b86c-4a8e-8db3-cc48f66dacf4">

<br>
<br>

This project implements compute-based point cloud rendering using software rasterization techniques in WebGPU, and compares it with traditional rendering approaches as implemented in [Three.js](https://threejs.org/) and other [WebGPU implementations](https://webgpu.github.io/webgpu-samples/?sample=points). Based on [research](https://github.com/m-schuetz/compute_rasterizer?tab=readme-ov-file) of Markus Schütz.

## Data Generation

Run `data-generator/index.html` in the browser to generate Fibonacci spheres of different size and point densities in `.drc` format.

## Rendering

### WebGPU

To launch the various WebGPU implementations, including the compute-based software rasterization approach run `wgpu/index.html` in the browser with the following query parameters:

`loadPath`: path to `.drc` data to be loaded<br>
`pipeline`: "points", "quads" or "compute"<br>
> `compute`: compute-based software rasterization technique ([Reference](https://github.com/m-schuetz/compute_rasterizer?tab=readme-ov-file))<br>
> `points`: using the WebGPU point primitve ([Reference](https://webgpu.github.io/webgpu-samples/?sample=points))<br>
> `quads`: rendering points as quads ([Reference](https://webgpu.github.io/webgpu-samples/?sample=points))<br>

`repaint`: number of times the same geometry is redrawn within a single frame, useful for performance testing with large numbers of points<br>
`size`: size of points, only effective with "quads" pipeline option (**\***)<br>

### Three.js

To launch the Three.js implementation run `three/index.html` in the browser with the following query parameters:

`useWebGPU`: if parameter is present use WebGPU backend, otherwise default to WebGL<br>
`loadPath`: path to `.drc` data to be loaded<br>
`repaint`: number of times the same geometry is redrawn within a single frame, useful for performance testing with large numbers of points<br>
`pointSize`: size of points, only effective with WebGL (**\***)<br>

***
(**\***) *Note*: The definition of "point primitive" is different between WebGL and WebGPU. In WebGPU, using the point primitve means rendering each point as a single pixel using a separate geometry pipeline that is more lightweight than traditional triangle-based rasterization. In WebGL, the "point primitive" falls back to using quads, composed of two triangles, to render points.

For this reason, the option to change point size is only available for some approaches.
