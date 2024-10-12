import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

let _drcLoader = null;
let drcLoader = () => {
    if (_drcLoader === null) {
        _drcLoader = new DRACOLoader();
        _drcLoader.setDecoderPath('../draco/');
    }
    return _drcLoader;
};

export function loadDRC(path) {
    return new Promise((resolve, reject) => {
        drcLoader().load(
            path,
            (geometry) => {
                resolve(geometry);
            },
            null,
            (error) => {
                reject(error);
            }
        );
    });
};
