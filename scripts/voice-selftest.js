async function main() {
  const checks = [];
  try {
    const sherpa = (await import('sherpa-onnx-node')).default;
    checks.push({
      name: 'sherpa-onnx-node',
      ok: typeof sherpa.KeywordSpotter === 'function' && typeof sherpa.LinearResampler === 'function',
      version: sherpa.version,
    });
  } catch (error) {
    checks.push({ name: 'sherpa-onnx-node', ok: false, error: String(error?.message ?? error) });
  }
  try {
    const cpal = (await import('node-cpal')).default;
    const host = cpal.defaultHost();
    const device = host.defaultInputDevice();
    const format = device?.defaultInputConfig().sampleFormat();
    checks.push({
      name: 'node-cpal',
      ok: typeof cpal.defaultHost === 'function' && !!device && !!format,
      device: device?.description().toString() ?? null,
      format: format?.toString() ?? null,
    });
    device?.close?.();
    host.close?.();
  } catch (error) {
    checks.push({ name: 'node-cpal', ok: false, error: String(error?.message ?? error) });
  }
  console.log(JSON.stringify(checks, null, 2));
  if (checks.some((check) => !check.ok)) {
    console.log('\n缺少依赖。运行 npm install，或只使用 Ctrl+Alt+Space 手动唤醒。');
    process.exitCode = 1;
  }
}

main();

