import path from 'node:path';

export const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 15000;

export function createRuntimePatch({ root, home, config }) {
  const plugin = name => path.join(root, 'packages', name, 'dist/index.mjs').replaceAll('\\', '/');
  return [
    { id: 'webserver', disabled: true },
    { id: 'typert-gateway', name: '@deepseek-ai/dsh-api-gateway', config: { websocketHeartbeatIntervalMs: WEBSOCKET_HEARTBEAT_INTERVAL_MS } },
    { insert: [
      { id: 'amadeus-webserver', name: plugin('login'), inject: ['webStartup'], config: { host: config.host || '0.0.0.0', port: config.port ?? 3080, username: config.username, password: config.password, sessionHours: config.sessionHours ?? 12, compression: 'gzip', compressionLevel: 1, compressionThresholdBytes: 1024 } },
      { id: 'amadeus-terminal', name: plugin('terminal') },
      { id: 'amadeus-files', name: plugin('files'), config: { maxUploadBytes: config.maxUploadBytes ?? 1024 ** 3, maxTextBytes: config.maxTextBytes ?? 5 * 1024 ** 2 } },
      { id: 'amadeus-reader', name: plugin('reader'), config: { executable: config.onlyOfficeBuilder || 'docbuilder', mode: config.onlyOfficeMode || 'native', image: config.onlyOfficeImage, fontsDir: config.onlyOfficeFontsDir, cacheVersion: config.previewCacheVersion, workers: config.previewWorkers ?? 1, timeoutMs: config.previewTimeoutMs ?? 120000, cacheDir: path.join(home, 'preview-cache'), maxFileBytes: config.maxPreviewBytes ?? 512 * 1024 ** 2, kpsewhich: config.kpsewhich || 'kpsewhich' } },
    ] },
  ];
}
