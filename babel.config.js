module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      {
        exclude: /node_modules/,
        plugins: [
          ['@babel/plugin-proposal-decorators', { legacy: true }],
          ['@babel/plugin-proposal-class-properties', { loose: true }],
          'react-native-reanimated/plugin',
        ],
      },
      {
        include: /node_modules/,
        plugins: ['react-native-reanimated/plugin'],
      },
    ],
  };
};
