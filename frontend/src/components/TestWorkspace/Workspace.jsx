import React, { useState } from 'react';
import { useTestStore } from '../../store/useTestStore';

const Workspace = () => {
  const { vcdFiles, firmwareFiles, addJob } = useTestStore();
  const [iterations, setIterations] = useState(1);

  const handleCreateJob = (vcd, fw) => {
    const newJob = {
      id: crypto.randomUUID(),
      vcd: vcd,
      firmware: fw, // สามารถดัดแปลงให้รับเป็น Array ของ ERQM, ULP ได้
      iterations: iterations,
      status: 'pending',
      timestamp: new Date().toLocaleString()
    };
    addJob(newJob);
    alert("Job Created and Added to Queue!");
  };

  
const handleSaveConfig = () => {
    const config = {
      vcd: selectedVcd,
      firmware: selectedFirmware,
      iterations: iterations,
      timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'test_setup.json';
    link.click();
  };

  return (
    <div className="flex-1 p-6 space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-medium mb-4 text-blue-400">Setup New Test Pair</h3>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* ส่วนจำลองการ Drop VCD */}
          <div className="border-2 border-dashed border-gray-700 rounded-lg p-4 flex flex-col items-center justify-center min-h-[150px] hover:border-blue-500 transition-colors">
            <span className="text-gray-500 text-sm">Drop VCD Here</span>
          </div>
          
          {/* ส่วนจำลองการ Drop Firmware */}
          <div className="border-2 border-dashed border-gray-700 rounded-lg p-4 flex flex-col items-center justify-center min-h-[150px] hover:border-orange-500 transition-colors">
            <span className="text-gray-500 text-sm">Drop Firmware (ERQM/ULP) Here</span>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg">
          <label className="text-sm text-gray-400">Number of Iterations:</label>
          <input 
            type="number" 
            value={iterations} 
            onChange={(e) => setIterations(e.target.value)}
            className="bg-gray-950 border border-gray-700 rounded px-3 py-1 w-24 outline-none focus:border-blue-500"
          />
          <button 
            onClick={() => handleCreateJob(vcdFiles[0], firmwareFiles[0])}
            className="ml-auto bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-md font-bold transition-all"
          >
            Create Test Job
          </button>
        </div>
      </div>
    </div>
  );
};

export default Workspace;onabort