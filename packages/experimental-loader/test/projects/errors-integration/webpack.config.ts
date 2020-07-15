import { stylableLoaders } from '../../../src';

module.exports = {
    mode: 'development',
    entry: './index.js',
    context: __dirname,
    devtool: false,
    module: {
        rules: [
            {
                test: /\.st\.css$/i,
                use: [
                    stylableLoaders.transform({
                        exportsOnly: true,
                    }),
                ],
            },
        ],
    },
};
