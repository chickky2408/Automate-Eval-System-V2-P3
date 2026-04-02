import { useTestStore } from '../store/useTestStore';

export const useFileUpload = () => {
  const { vcdFiles, firmwareFiles, addVcdFile, addFirmwareFile } = useTestStore();

  const checkAndRename = (file, existingFiles) => {
    let name = file.name;
    let counter = 1;
    const extension = name.split('.').pop();
    const baseName = name.replace(`.${extension}`, "");

    while (existingFiles.some(f => f.name === name)) {
      name = `${baseName}_v${counter}.${extension}`;
      counter++;
    }
    return name;
  };

  const uploadFile = (file, type) => {
    const isVcd = type === 'VCD';
    const existing = isVcd ? vcdFiles : firmwareFiles;
    const finalName = checkAndRename(file, existing);
    
    const newFileObject = {
      id: crypto.randomUUID(),
      name: finalName,
      originalName: file.name,
      size: file.size,
      uploadDate: new Date().toISOString(),
      type: type // VCD, ERQM, ULP
    };


    // ไอเดียเพิ่มเติมสำหรับระบบ Grouping
const groupFilesByVcd = (vcdFile, firmwareFiles) => {
    return {
      groupId: `group_${vcdFile.id}`,
      vcd: vcdFile,
      firmwares: firmwareFiles, // เก็บเป็น Array ของ ERQM, ULP
      status: 'ready'
    };
  };

    if (isVcd) addVcdFile(newFileObject);
    else addFirmwareFile(newFileObject);
  };

  return { uploadFile };
};