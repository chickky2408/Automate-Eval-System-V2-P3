export const generateTestJson = (vcd, firmwareList, iterations) => {
    return {
      test_id: crypto.randomUUID(),
      vcd_source: vcd.path,
      firmware_configs: firmwareList.map(fw => ({
        type: fw.type, // ERQM หรือ ULP
        version: fw.version,
        path: fw.path
      })),
      settings: {
        loop_count: iterations,
        stop_on_fail: true
      }
    };
  };