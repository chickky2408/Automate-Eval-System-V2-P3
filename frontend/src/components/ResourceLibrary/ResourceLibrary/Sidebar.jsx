import React from 'react';
import { useTestStore } from '../../store/useTestStore';

const Sidebar = () => {
  const { vcdFiles, firmwareFiles } = useTestStore();

  return (
    <div className="w-72 border-r border-gray-800 bg-gray-900 h-full p-4 flex flex-col">
      <h2 className="text-xl font-bold text-blue-400 mb-6">Resource Library</h2>
      
      <div className="space-y-6 overflow-y-auto">
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">VCD Files</h3>
          <div className="space-y-2">
            {vcdFiles.map(file => (
              <div key={file.id} className="p-3 bg-gray-800 rounded border border-gray-700 hover:border-blue-500 cursor-grab active:cursor-grabbing">
                <p className="text-sm truncate"> 📂 {file.name}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Firmware (ERQM/ULP)</h3>
          <div className="space-y-2">
            {firmwareFiles.map(file => (
              <div key={file.id} className="p-3 bg-gray-800 rounded border border-gray-700 hover:border-orange-500 cursor-grab">
                <p className="text-sm truncate"> 💾 {file.name}</p>``
                <span className="text-[10px] text-gray-500 uppercase">{file.type}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Sidebar;