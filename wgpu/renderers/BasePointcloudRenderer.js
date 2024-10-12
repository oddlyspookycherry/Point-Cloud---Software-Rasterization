export class BasePointcloudRenderer {
    
    _canvas;
    _repaint = 1;

    constructor(canvas) {
        if (new.target === BasePointcloudRenderer) {
            throw new TypeError("Cannot construct BaseRenderer instances directly.");
        }
        this._canvas = canvas;
    }

    init() {
        throw new Error("Method 'init' must be implemented.");
    }

    setModel(threeGeometry) {
        throw new Error("Method 'setModel' must be implemented.");
    }

    // Optional
    setPointSize(size) {}

    // Number of times to redraw the geometry in the scene
    setRepaint(repaint) {
        this._repaint = repaint;
    }

    setMVP(matrix) {
        throw new Error("Method 'setMatrix' must be implemented.");
    }

    render() {
        throw new Error("Method 'render' must be implemented.");        
    }
}
