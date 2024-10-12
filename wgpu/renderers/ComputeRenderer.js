import { BasePointcloudRenderer } from './BasePointcloudRenderer.js';

const arrayProd = arr => arr.reduce((a, b) => a * b);

export class ComputeRenderer extends BasePointcloudRenderer {

    #device;
    #context;

    #renderPipeline;
    #renderWorkgroupSize = [4, 4, 4];
    #renderWorkgroupThreads = arrayProd(this.#renderWorkgroupSize);
    #renderDispatchSize;
    #frameBuffer;
    #clearFrameBuffer;
    #resolvePipeline;
    #resolveWorkgroupSize = [4, 4, 4];

    #presentationFormat;
    
    #resizeObserver;

    #pointBuffer;

    #uniformsValues;
    #uniformBuffer;
    #uniformsViews;

    #pointGroup;
    #pointGroupLayout;
    #frameGroup;
    #frameGroupLayout;
    #canvasGroup;
    #canvasGroupLayout;
    #pipelineLayout;

    /**
     * @override
     */
    async init() {
        await this.#initContext();
        this.#initResizeObserver();
        this.#initLayout();
        this.#initResolvePipeline();
        this.#initRenderPipeline();
        this.#initUniform();
    }

    /**
     * @override
     */
    setModel(threeGeometry) {

        const positions = threeGeometry.getAttribute('position').array;
        const colors = threeGeometry.getAttribute('color').array;

        const numPoints = positions.length / 3;

        // 8 floats per point (3 for position, 3 for color, 2 for padding)
        const pointBufferData = new Float32Array(8 * numPoints);
        for (let i = 0, p = 0, c = 0; i < pointBufferData.length; i += 8, p += 3, c += 3) {
            pointBufferData[i] = positions[p];
            pointBufferData[i + 1] = positions[p + 1];
            pointBufferData[i + 2] = positions[p + 2];
            pointBufferData[i + 3] = 0;
            pointBufferData[i + 4] = colors[c];
            pointBufferData[i + 5] = colors[c + 1];
            pointBufferData[i + 6] = colors[c + 2];
            pointBufferData[i + 7] = 0;
        }

        this.#initPointGroup(pointBufferData);
        this.#uniformsViews.num_points.set([numPoints]);
        this.#renderDispatchSize = this.#computeRenderDispatchSize(numPoints);
    }

    /**
     * @override
     */
    setMVP(matrix) {
        this.#uniformsViews.matrix.set(matrix);
    }

    /**
     * @override
     */
    setRepaint(repaint) {
        super.setRepaint(repaint);

    }

    /**
     * @override
     */
    render() {

        const canvasTexture = this.#context.getCurrentTexture();
        this.#canvasGroup = this.#device.createBindGroup({
            label: 'canvas group',
            layout: this.#canvasGroupLayout,
            entries: [
                { binding: 0, resource: canvasTexture.createView() },
            ],
        });

        const computeEncoder = this.#device.createCommandEncoder();
        // Clear frame buffer
        computeEncoder.copyBufferToBuffer(this.#clearFrameBuffer, 0, this.#frameBuffer, 0, this.#clearFrameBuffer.size);

        const computePass = computeEncoder.beginComputePass();

        // Bind group reused across pipelines
        computePass.setPipeline(this.#renderPipeline);
        computePass.setBindGroup(2, this.#canvasGroup);
        computePass.setBindGroup(1, this.#frameGroup);
        
        for (let i = 0; i < this._repaint; i++) {
            this.#device.queue.writeBuffer(this.#uniformBuffer, 0, this.#uniformsValues);
            computePass.setBindGroup(0, this.#pointGroup);
            computePass.dispatchWorkgroups(...this.#renderDispatchSize);
        }        

        computePass.setPipeline(this.#resolvePipeline);

        computePass.dispatchWorkgroups(canvasTexture.width, canvasTexture.height);
        computePass.end();

        this.#device.queue.submit([computeEncoder.finish()]);
    }

    async #initContext() {
        const adapter = await navigator.gpu?.requestAdapter();
        this.#presentationFormat = adapter.features.has('bgra8unorm-storage')
            ? navigator.gpu.getPreferredCanvasFormat()
            : 'rgba8unorm';
        this.#device = await adapter?.requestDevice({
            requiredFeatures: this.#presentationFormat === 'bgra8unorm'
                ? ['bgra8unorm-storage']
                : [],
            requiredLimits: {
                maxBufferSize: adapter.limits.maxBufferSize,
                maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            },
        });
        if (!this.#device) {
            throw new Error('This browser does not support WebGPU.');
        }
        this.#context = this._canvas.getContext('webgpu');
        this.#context.configure({
            device: this.#device,
            format: this.#presentationFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
        });
    }

    #initResizeObserver() {
        this.#resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const canvas = entry.target;
                const width = entry.contentBoxSize[0].inlineSize;
                const height = entry.contentBoxSize[0].blockSize;
                canvas.width = Math.max(1, Math.min(width, this.#device.limits.maxTextureDimension2D));
                canvas.height = Math.max(1, Math.min(height, this.#device.limits.maxTextureDimension2D));

                this.#initFrameBuffer(canvas.width, canvas.height);
                this.#uniformsViews.resolution.set([width, height]);
            }
        });
        this.#resizeObserver.observe(this._canvas);
    }

    #initLayout() {
        this.#pointGroupLayout = this.#device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "uniform"
                    }
                },
            ]
        });

        this.#frameGroupLayout = this.#device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "storage",
                    },
                },
            ]
        });

        this.#canvasGroupLayout = this.#device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        format: this.#presentationFormat,
                    },
                }
            ]
        });

        this.#pipelineLayout = this.#device.createPipelineLayout({
            bindGroupLayouts: [this.#pointGroupLayout, this.#frameGroupLayout, this.#canvasGroupLayout],
        });
    }

    #initRenderPipeline() {
        const renderModule = this.#device.createShaderModule({
            code: `
    
        struct Point {
            position: vec3f,
            color: vec3f,
        };
    
        struct Uniforms {
            matrix: mat4x4f,
            resolution: vec2f,
            num_points: u32,
        };
    
        @group(0) @binding(0) var<storage, read> points: array<Point>;
        @group(0) @binding(1) var<uniform> uni: Uniforms;
        @group(1) @binding(0) var<storage, read_write> frameBuffer: array<atomic<u32>>;
    
        fn toPixelID(pos: vec4f) -> u32 {
            let pixelX = u32((pos.x + 1.0) * 0.5 * uni.resolution.x);
            let pixelY = u32((pos.y + 1.0) * 0.5 * uni.resolution.y);
    
            return pixelX + pixelY * u32(uni.resolution.x);
        }
    
        @compute @workgroup_size(${this.#renderWorkgroupSize}) fn render(
            @builtin(workgroup_id) workgroup_id : vec3u,
            @builtin(local_invocation_index) local_invocation_index: u32,
            @builtin(num_workgroups) num_workgroups: vec3u
        ) {
            let workgroup_index =
                workgroup_id.x +
                workgroup_id.y * num_workgroups.x +
                workgroup_id.z * num_workgroups.x * num_workgroups.y;

            let global_invocation_index =
                workgroup_index * ${this.#renderWorkgroupThreads} +
                local_invocation_index;
            if (global_invocation_index > uni.num_points) {
                return;
            }
            
            let p = points[global_invocation_index];
            var clipPos = uni.matrix * vec4f(p.position, 1.0);
            clipPos /= clipPos.w;
            
            if (clipPos.x < -1 || clipPos.x > 1 || clipPos.y < -1 || clipPos.y > 1 || clipPos.z < 0 || clipPos.z > 1) {
                return;
            }
            
            let depth = clipPos.z;
            let depthUint8 = u32(depth * 255);
            let redUint8 = u32(p.color.x * 255);
            let greenUint8 = u32(p.color.y * 255);
            let blueUint8 = u32(p.color.z * 255);
            let entry = (depthUint8 << 24) | (redUint8 << 16) | (greenUint8 << 8) | blueUint8;

            let pixel = toPixelID(clipPos);

            atomicMin(&frameBuffer[pixel], entry);
        }
    `,
        });

        const renderPipeline = this.#device.createComputePipeline({
            label: 'render pipeline',
            layout: this.#pipelineLayout,
            compute: {
                module: renderModule,
                entryPoint: 'render',
            },
        });

        this.#renderPipeline = renderPipeline;
    }

    #computeRenderDispatchSize(numPoints) {
        const kNumWorkgroups = Math.ceil(numPoints / this.#renderWorkgroupThreads);

        const kDispatchSize = new Array(3).fill(1);
        const dimensionLimit = this.#device.limits.maxComputeWorkgroupsPerDimension;
        let w = kNumWorkgroups;
        for (let i = 0; i < 3; i++) {
            if (w <= dimensionLimit) {
                kDispatchSize[i] = w;
                break;
            }
            kDispatchSize[i] = dimensionLimit;
            w = Math.ceil(w / dimensionLimit);
        }

        return kDispatchSize;
    }

    #initResolvePipeline() {
        const computeResolveModule = this.#device.createShaderModule({
            code: `

            struct Uniforms {
                matrix: mat4x4f,
                resolution: vec2f,
                num_points: u32,
            };

            @group(0) @binding(1) var<uniform> uni: Uniforms;
            @group(1) @binding(0) var<storage, read_write> frameBuffer: array<u32>;
            @group(2) @binding(0) var outTexture: texture_storage_2d<${this.#presentationFormat}, write>;
            @compute @workgroup_size(${this.#resolveWorkgroupSize}) fn resolve(
                @builtin(global_invocation_id) global_invocation_id : vec3<u32>,
            ) {

                let global_invocation_linear = global_invocation_id.x + global_invocation_id.y * u32(uni.resolution.x);

                let redU8 = (frameBuffer[global_invocation_linear] >> 16) & 0xFF;
                let greenU8 = (frameBuffer[global_invocation_linear] >> 8) & 0xFF;
                let blueU8 = (frameBuffer[global_invocation_linear]) & 0xFF;
                let redF32 = f32(redU8) / 255.0;
                let greenF32 = f32(greenU8) / 255.0;
                let blueF32 = f32(blueU8) / 255.0;

                let color = vec4f(redF32, greenF32, blueF32, 1.0);

                let texelCoord = vec2u(global_invocation_id.x, global_invocation_id.y);
                textureStore(outTexture, texelCoord, color);
            }
        `,
        });

        const resolvePipeline = this.#device.createComputePipeline({
            label: 'resolve pipeline',
            layout: this.#pipelineLayout,
            compute: {
                module: computeResolveModule,
                entryPoint: 'resolve',
            },
        });

        this.#resolvePipeline = resolvePipeline;
    }

    #initUniform() {
        const uniformsValues = new ArrayBuffer(80);
        const uniformsViews = {
            matrix: new Float32Array(uniformsValues, 0, 16),
            resolution: new Float32Array(uniformsValues, 64, 2),
            num_points: new Uint32Array(uniformsValues, 72, 1),
        };

        const uniformBuffer = this.#device.createBuffer({
            size: uniformsValues.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.#uniformsValues = uniformsValues;
        this.#uniformBuffer = uniformBuffer;
        this.#uniformsViews = uniformsViews;
    }

    #initPointBuffer(pointData) {
        const pointBuffer = this.#device.createBuffer({
            label: 'point buffer',
            size: pointData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(pointBuffer.getMappedRange()).set(pointData);
        pointBuffer.unmap();
        
        this.#pointBuffer = pointBuffer;
    }

    #initFrameBuffer(width, height) {
        this.#frameBuffer = this.#device.createBuffer({
            label: 'frame buffer',
            size: 4 * width * height,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.#clearFrameBuffer = this.#device.createBuffer({
            label: 'clear frame buffer',
            size: 4 * width * height,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });

        // Have to write each pixel of clear buffer as a u32, to avoid issues with endianness
        const clearFrame = new Uint32Array(width * height);
        for (let i = 0; i < clearFrame.length; i++) {
            clearFrame[i] = 0xff000000;
        }
        new Uint32Array(this.#clearFrameBuffer.getMappedRange()).set(clearFrame);
        this.#clearFrameBuffer.unmap();

        this.#frameGroup = this.#device.createBindGroup({
            label: 'frame group',
            layout: this.#frameGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.#frameBuffer } },
            ],
        });
    }

    #initPointGroup(pointData) {

        this.#initPointBuffer(pointData);

        this.#pointGroup = this.#device.createBindGroup({
            label: 'point group',
            layout: this.#pointGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.#pointBuffer } },
                { binding: 1, resource: { buffer: this.#uniformBuffer } },
            ],
        });
    }

}