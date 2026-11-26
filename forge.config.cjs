module.exports = {
  outDir: process.env.TEAHOUSE_BUILD_OUTPUT,
  packagerConfig: {
    asar: true,
    executableName: 'MoonTeahouse',
    icon: './assets/app.ico',
    extraResource: [
      './services',
      ...[process.env.TEAHOUSE_DEEPSEEK_RUNTIME, process.env.TEAHOUSE_QWEN_MODEL].filter(Boolean),
    ],
    electronZipDir: process.env.TEAHOUSE_ELECTRON_ZIP_DIR,
    ignore: [/^\/out(?:\/|$)/, /^\/src/, /^\/test/, /^\/docs/, /^\/services/, /^\/scripts/, /^\/tsconfig/],
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'MoonTeahouse', setupExe: 'MoonTeahouse-Setup.exe', setupIcon: './assets/app.ico', noMsi: true } },
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
};
