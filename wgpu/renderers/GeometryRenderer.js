import { BasePointcloudRenderer } from './BasePointcloudRenderer.js';

export const GeometryRendererMode = Object.freeze({
    POINTS: 'points',
    QUADS: 'quads',
});

export class GeometryRenderer extends BasePointcloudRenderer {
    
    #device;
    #context;

    #presentationFormat;
    #depthFormat = 'depth24plus';

    #pipeline;
    #renderPassDescriptor;
    #renderBundle;

    #kNumPoints;
    #vertexBuffer;

    #uniformBuffer;
    #uniformsViews;
    #uniformsValues;

    #bindGroup;

    #depthTexture;

    #resizeObserver;

    #mode;

    /**
     * @override
     */
    constructor(canvas, options) {
        super(canvas);
        if (!options.mode) {
            throw new Error("Options mode is not set.");
        }
        if (options.mode !== GeometryRendererMode.POINTS && options.mode !== GeometryRendererMode.QUADS) {
            throw new Error("Options mode is not supported.");
        }
        this.#mode = options.mode;
    }

    /**
     * @override
     */
    async init() {
        await this.#initContext();
        this.#initResizeObserver();
        if (this.#mode === GeometryRendererMode.POINTS) {
            this.#initPointPipeline();
        } else if (this.#mode === GeometryRendererMode.QUADS) {
            this.#initQuadPipeline();
        } else {
            throw new Error("Options mode is not supported.");
        }
        this.#initRenderPassDescriptor();
        this.#initUniforms();
    }

    /**
     * @override
     */
    setModel(threeGeometry) {

        const positions = threeGeometry.getAttribute('position').array;
        const colors = threeGeometry.getAttribute('color').array;

        this.#kNumPoints = positions.length / 3;
    
        const vertexData = new Float32Array(positions.length + colors.length);
        for (let i = 0, p = 0, c = 0; i < vertexData.length; i += 6, p += 3, c += 3) {
            vertexData[i] = positions[p];
            vertexData[i + 1] = positions[p + 1];
            vertexData[i + 2] = positions[p + 2];
            vertexData[i + 3] = colors[c];
            vertexData[i + 4] = colors[c + 1];
            vertexData[i + 5] = colors[c + 2];
        }

        const vertexBuffer = this.#device.createBuffer({
            label: 'vertex buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
        vertexBuffer.unmap();

        this.#vertexBuffer = vertexBuffer;

        // After the model is set we can create the render bundle with vertex buffer assignment
        this.#initRenderBundle();
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
    setPointSize(size) {
        this.#uniformsViews.size[0] = size;
    }

    /**
     * @override
     */
    setRepaint(repaint) {
        super.setRepaint(repaint);
        this.#initRenderBundle();   
    }

    /**
     * @override
     */
    render() {
        // Get the current texture from the canvas context and
        // set it as the texture to render to.
        const canvasTexture = this.#context.getCurrentTexture();
        this.#renderPassDescriptor.colorAttachments[0].view =
            canvasTexture.createView();

        // If we don't have a depth texture OR if its size is different
        // from the canvasTexture when make a new depth texture
        if (!this.#depthTexture ||
            this.#depthTexture.width !== canvasTexture.width ||
            this.#depthTexture.height !== canvasTexture.height) {
            if (this.#depthTexture) {
                this.#depthTexture.destroy();
            }
            this.#depthTexture = this.#device.createTexture({
                size: [canvasTexture.width, canvasTexture.height],
                format: this.#depthFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
        }
        this.#renderPassDescriptor.depthStencilAttachment.view = this.#depthTexture.createView();

        // Copy the uniform values to the GPU
        this.#uniformsViews.resolution.set([canvasTexture.width, canvasTexture.height]);
        this.#device.queue.writeBuffer(this.#uniformBuffer, 0, this.#uniformsValues);

        const commandEncoder = this.#device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass(this.#renderPassDescriptor);
        passEncoder.executeBundles([this.#renderBundle]);
        passEncoder.end();
        const commandBuffer = commandEncoder.finish();
        this.#device.queue.submit([commandBuffer]);
    }        

    async #initContext() {
        const adapter = await navigator.gpu?.requestAdapter();
        this.#device = await adapter?.requestDevice({
            requiredLimits: {
                maxBufferSize: adapter.limits.maxBufferSize,
            },
        });
        if (!this.#device) {
            throw new Error('This browser does not support WebGPU.');
        }
        this.#context = this._canvas.getContext('webgpu');
        this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.#context.configure({
            device: this.#device,
            format: this.#presentationFormat,
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
            }
        });
        this.#resizeObserver.observe(this._canvas);
    }

    #initPointPipeline() {
        const module = this.#device.createShaderModule({
            code: `
            struct Vertex {
                @location(0) position: vec4f,
                @location(1) color: vec4f,
            };

            struct Uniforms {
                matrix: mat4x4f,
                resolution: vec2f,
                size: f32,
            };

            struct VSOutput {
                @builtin(position) position: vec4f,
                @location(1) color: vec4f,
            };

            @group(0) @binding(0) var<uniform> uni: Uniforms;

            @vertex fn vs(
                vert: Vertex,
            ) -> VSOutput {

                var vsOut: VSOutput;
                vsOut.position = uni.matrix * vert.position;
                vsOut.color = vert.color;
                return vsOut;
            }

            @fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
                return vsOut.color;
            }
        `,
        });

        const pipeline = this.#device.createRenderPipeline({
            label: '3d points pointlist',
            layout: 'auto',
            vertex: {
                module,
                buffers: [
                    {
                        arrayStride: (3 + 3) * 4, // 3 pos + 3 color, 4 bytes each
                        stepMode: 'vertex',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
                            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },  // color
                        ],
                    },
                ],
            },
            fragment: {
                module,
                targets: [
                    {
                        format: this.#presentationFormat,
                    },
                ],
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: this.#depthFormat,
            },
            primitive: {
                topology: 'point-list',
            },
        });

        this.#pipeline = pipeline;
    }

    #initQuadPipeline() {
        const module = this.#device.createShaderModule({
            code: `
            struct Vertex {
                @location(0) position: vec4f,
                @location(1) color: vec4f,
            };

            struct Uniforms {
                matrix: mat4x4f,
                resolution: vec2f,
                size: f32,
            };

            struct VSOutput {
                @builtin(position) position: vec4f,
                @location(1) color: vec4f,
            };

            @group(0) @binding(0) var<uniform> uni: Uniforms;

            @vertex fn vs(
                vert: Vertex,
                @builtin(vertex_index) vNdx: u32,
            ) -> VSOutput {
                let points = array(
                    vec2f(-1, -1),
                    vec2f( 1, -1),
                    vec2f(-1,  1),
                    vec2f(-1,  1),
                    vec2f( 1, -1),
                    vec2f( 1,  1),
                );
                var vsOut: VSOutput;
                let pos = points[vNdx];
                let clipPos = uni.matrix * vert.position;
                let pointPos = vec4f(pos * uni.size / uni.resolution * clipPos.w, 0, 0);
                vsOut.position = clipPos + pointPos;
                vsOut.color = vert.color;
                return vsOut;
            }

            @fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
                return vsOut.color;
            }
        `,
        });
        
        const pipeline = this.#device.createRenderPipeline({
            label: '3d points quads',
            layout: 'auto',
            vertex: {
                module,
                buffers: [
                    {
                        arrayStride: (3 + 3) * 4, // 3 pos + 3 color, 4 bytes each
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
                            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },  // color
                        ],
                    },
                ],
            },
            fragment: {
                module,
                targets: [
                    {
                        format: this.#presentationFormat,
                    },
                ],
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: this.#depthFormat,
            },
        });

        this.#pipeline = pipeline;
    }

    #initRenderPassDescriptor() {
        // Create a pass descriptor
        const renderPassDescriptor = {
            label: 'render pass',
            colorAttachments: [
                {
                    view: undefined, // to be filled out when we render
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            depthStencilAttachment: {
                view: undefined, // to be filled out when we render
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        };
        
        this.#renderPassDescriptor = renderPassDescriptor;
    }

    #initRenderBundle() {
        const renderBundleEncoder = this.#device.createRenderBundleEncoder({
            label: 'render bundle',
            colorFormats: [this.#presentationFormat],
            depthStencilFormat: this.#depthFormat,
        });
        renderBundleEncoder.setPipeline(this.#pipeline);
        for (let i = 0; i < this._repaint; i++) {
            renderBundleEncoder.setVertexBuffer(0, this.#vertexBuffer);
            renderBundleEncoder.setBindGroup(0, this.#bindGroup);
            if (this.#mode === GeometryRendererMode.POINTS) {
                renderBundleEncoder.draw(this.#kNumPoints);
            } else if (this.#mode === GeometryRendererMode.QUADS) {
                renderBundleEncoder.draw(6, this.#kNumPoints);
            } else {
                throw new Error("Options mode is not supported.");
            }
        }
        const renderBundle = renderBundleEncoder.finish();
        this.#renderBundle = renderBundle;
    }

    /**
     * Both the pipelines use the same uniform buffer layout.
     * The point size and resolution of the uniform buffer are ignored in the point pipeline,
     * as only pixel sized points are supported with point-list.
     * Although a smaller uniform buffer could be used for the point pipeline, the same buffer is used for simplicity,
     * as the difference is negligible.
     */
    #initUniforms() {
        const uniformsValues = new ArrayBuffer(80);
        const uniformsViews = {
            matrix: new Float32Array(uniformsValues, 0, 16),
            resolution: new Float32Array(uniformsValues, 64, 2),
            size: new Float32Array(uniformsValues, 72, 1),
        };
        const uniformBuffer = this.#device.createBuffer({
            size: uniformsValues.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.#uniformsValues = uniformsValues;
        this.#uniformBuffer = uniformBuffer;
        this.#uniformsViews = uniformsViews;
        this.#bindGroup = this.#device.createBindGroup({
            layout: this.#pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
            ],
        });
    }
}