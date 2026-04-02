import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Copy, Download, FileCode, FileDown, FileJson, FileUp, FolderOpen, Layers, Plus, RefreshCw, Save, Search, Trash2, Upload, X
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import api from '../services/api';
import { computeFileSignature } from '../utils/fileSignature';
import UploadChoiceModal from '../components/UploadChoiceModal';


const SetupPage = ({ editJobId, onEditComplete }) => {
  const { 
    uploadedFiles, 
    addUploadedFile, 
    removeUploadedFile, 
    createJob,
    updateJob,
    runTestCommand,
    jobs, 
    boards, 
    testCommands,
    loading,
    errors,
    addTestCommand,
    updateTestCommand,
    deleteTestCommand,
    duplicateTestCommand
  } = useTestStore();
  const addToast = useTestStore((state) => state.addToast);
  const runBoardSelection = useTestStore((s) => s.runBoardSelection);
  const setRunBoardSelection = useTestStore((s) => s.setRunBoardSelection);
    const [selectedIds, setSelectedIds] = useState([]);
  const [isLoadingPairs, setIsLoadingPairs] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const [configName, setConfigName] = useState('Default_Setup');
  const [tag, setTag] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedBoardIds, setSelectedBoardIds] = useState([]);
  const [boardSelectionMode, setBoardSelectionMode] = useState('auto'); // 'auto' | 'manual'
  const setupBoardInitDone = useRef(false);
  useEffect(() => {
    if (setupBoardInitDone.current || !boards?.length) return;
    setupBoardInitDone.current = true;
    const stored = runBoardSelection || { mode: 'auto', boardIds: [] };
    setBoardSelectionMode(stored.mode);
    const validIds = (stored.boardIds || []).filter((id) => boards.some((b) => b.id === id));
    setSelectedBoardIds(validIds);
  }, [runBoardSelection, boards]);
  const [testNowHighPriority, setTestNowHighPriority] = useState(false);
  const [selectedTestCommand, setSelectedTestCommand] = useState(null);
  const [setupMode, setSetupMode] = useState('files'); // 'files' | 'commands'
  const [showCommandManager, setShowCommandManager] = useState(false);
  const [editingCommand, setEditingCommand] = useState(null);
  const [setupErrors, setSetupErrors] = useState({ files: '', boards: '', command: '' });
  const [fileValidationErrors, setFileValidationErrors] = useState([]);
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);
  const [isRunningCommand, setIsRunningCommand] = useState(false);
  const [fileFilter, setFileFilter] = useState('all'); // 'all' | 'vcd' | 'bin'
  const [fileSearch, setFileSearch] = useState('');
  const [fileSort, setFileSort] = useState('time'); // time | file-name | tag | name-asc | name-desc
  const [selectedPairVcdId, setSelectedPairVcdId] = useState('');
  const [selectedPairBinId, setSelectedPairBinId] = useState('');
  const [selectedPairLinId, setSelectedPairLinId] = useState('');
  const [selectedPairs, setSelectedPairs] = useState([]);
  const [isDraggingJson, setIsDraggingJson] = useState(false);
  const jsonInputRef = useRef(null);
  const [draggingRowIndex, setDraggingRowIndex] = useState(null);
  const [dropTargetRowIndex, setDropTargetRowIndex] = useState(null);
  const draggingRowIndexRef = useRef(null);
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);
  const [fileListExpanded, setFileListExpanded] = useState(false);
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState([]); // สำหรับ checkbox ใน pairs table
  const [uploadChoiceModal, setUploadChoiceModal] = useState(null); // { prepared } when showing per-file Reuse/Upload modal
  const [bulkTryCount, setBulkTryCount] = useState(''); // สำหรับ bulk edit try count
  const isAutoPairingRef = useRef(false); // ป้องกัน auto-pair ซ้ำ
  const isLoadingConfigRef = useRef(false); // track ว่าเป็นการ load config หรือไม่
  const prevUploadedCountRef = useRef(0); // ใช้เช็คว่าเพิ่ง upload ชุดแรกหรือเปล่า
  const [commandForm, setCommandForm] = useState({
    name: '',
    command: '',
    description: '',
    category: 'testing'
  });
  
  // Get unique tags from existing jobs for suggestions
  const existingTags = [...new Set(jobs.map(j => j.tag).filter(Boolean))];
  const selectableBoards = boards.filter(b => b.status === 'online');
  const toggleSelectedBoard = (id) => {
    setSelectedBoardIds((prev) => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      setRunBoardSelection({ mode: 'manual', boardIds: next });
      return next;
    });
  };
  
  // Replace placeholders in test command
  const getResolvedCommand = (cmd) => {
    if (!cmd || !cmd.command) return cmd?.command || '';
    let resolved = cmd.command;
    if (selectedBoardIds.length > 0) {
      resolved = resolved.replace(/{board_id}/g, selectedBoardIds[0]);
      resolved = resolved.replace(/{boards}/g, selectedBoardIds.join(','));
      // Get firmware from first selected board
      const firstBoard = boards.find(b => b.id === selectedBoardIds[0]);
      if (firstBoard && firstBoard.firmware) {
        resolved = resolved.replace(/{firmware}/g, firstBoard.firmware);
      }
    } else {
      // Keep placeholders if no boards selected
      resolved = resolved;
    }
    return resolved;
  };

  const pushFileError = (message) => {
    setFileValidationErrors((prev) => [...prev, message].slice(-3));
  };

  const validateSetup = (mode) => {
    const nextErrors = { files: '', boards: '', command: '' };
    if (mode === 'files' && selectedPairs.length === 0) {
      nextErrors.files = 'Create at least one test case pair.';
    }
    if (mode === 'commands' && !selectedTestCommand) {
      nextErrors.command = 'Select a test command.';
    }
    if (boardSelectionMode === 'manual' && selectedBoardIds.length === 0) {
      nextErrors.boards = 'Select at least one board.';
    }
    setSetupErrors(nextErrors);
    return !nextErrors.files && !nextErrors.command && !nextErrors.boards;
  };
  
  // File upload handlers
  const getFileKind = (file) => {
    const ext = String(file?.name || '').split('.').pop()?.toLowerCase();
    if (ext === 'vcd') return 'vcd';
    if (['bin', 'hex', 'elf', 'erom'].includes(ext)) return 'bin';
    if (['lin', 'txt', 'ulp'].includes(ext)) return 'lin';
    return 'other';
  };

  // ใช้เฉพาะไฟล์ที่ถูกเลือก (checkbox) — เรียงตาม selectedIds (ใช้กับ Create Batch และ move up/down)
  const selectedFiles = selectedIds
    .map((id) => uploadedFiles.find((f) => f.id === id))
    .filter(Boolean);
  const vcdFilesList = selectedFiles.filter((f) => getFileKind(f) === 'vcd');
  const binFilesList = selectedFiles.filter((f) => getFileKind(f) === 'bin');
  const linFilesList = selectedFiles.filter((f) => {
    const ext = String(f?.name || '').split('.').pop()?.toLowerCase();
    return ext === 'lin' || ext === 'txt' || ext === 'ulp'; // ULP/LIN files
  });

  // Auto-pair แบบ Smart: pair อัตโนมัติเมื่อ select files (แต่ไม่ pair เมื่อ load config)
  const autoPairSmart = useCallback(() => {
    // ไม่ auto-pair ถ้า:
    // 1. กำลัง load config
    // 2. กำลัง auto-pairing อยู่ (ป้องกัน loop)
    // 3. ไม่มี VCD หรือ BIN
    // 4. มี pairs อยู่แล้ว (ไม่ pair ซ้ำ)
    if (isLoadingConfigRef.current || isAutoPairingRef.current) return;
    
    const currentSelectedFiles = selectedIds
      .map((id) => uploadedFiles.find((f) => f.id === id))
      .filter(Boolean);
    const currentVcdFiles = currentSelectedFiles.filter((f) => getFileKind(f) === 'vcd');
    const currentBinFiles = currentSelectedFiles.filter((f) => getFileKind(f) === 'bin');
    
    if (currentVcdFiles.length === 0 || currentBinFiles.length === 0) return;
    
      setSelectedPairs((prev) => {
      // ถ้ามี pairs อยู่แล้ว หรือกำลัง auto-pairing อยู่ ไม่ต้อง auto-pair
      if (prev.length > 0 || isAutoPairingRef.current) return prev;
      
      isAutoPairingRef.current = true;
      const newPairs = [];
      
      // ใช้ลำดับจาก selectedFiles (ตาม selectedIds order) เพื่อ pair ตามที่ user เรียงไว้
      const orderedFiles = currentSelectedFiles;
      
      // หา VCD, BIN, LIN ตามลำดับที่เรียงไว้
      const orderedVcds = orderedFiles.filter(f => getFileKind(f) === 'vcd');
      const orderedBins = orderedFiles.filter(f => getFileKind(f) === 'bin');
      const orderedLins = orderedFiles.filter(f => {
        const ext = String(f?.name || '').split('.').pop()?.toLowerCase();
        return ext === 'lin' || ext === 'txt' || ext === 'ulp';
      });

      // Pair ตามลำดับที่เรียงไว้: VCD กับ BIN ที่อยู่ใกล้กันที่สุด
      orderedVcds.forEach((vcdFile, vcdIdx) => {
        const vcdIndexInOrdered = orderedFiles.findIndex(f => f.id === vcdFile.id);
        
        // หา BIN ที่ใกล้ที่สุด
        let nearestBin = null;
        let minDistance = Infinity;
        
        orderedBins.forEach(binFile => {
          const binIndexInOrdered = orderedFiles.findIndex(f => f.id === binFile.id);
          const distance = Math.abs(binIndexInOrdered - vcdIndexInOrdered);
          if (distance < minDistance) {
            minDistance = distance;
            nearestBin = binFile;
          }
        });

        const binFile = nearestBin || orderedBins[vcdIdx % orderedBins.length];
        
        // หา LIN ที่ใกล้ที่สุด (ถ้ามี)
        let nearestLin = null;
        let minLinDistance = Infinity;
        
        orderedLins.forEach(linFile => {
          const linIndexInOrdered = orderedFiles.findIndex(f => f.id === linFile.id);
          const distance = Math.abs(linIndexInOrdered - vcdIndexInOrdered);
          if (distance < minLinDistance) {
            minLinDistance = distance;
            nearestLin = linFile;
          }
        });

        newPairs.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}-${vcdIdx}`,
          vcdId: vcdFile.id,
          binId: binFile.id,
          linId: nearestLin?.id || null,
          try: 1,
        });
      });

      // Reset flag หลังจากเสร็จ
      setTimeout(() => {
        isAutoPairingRef.current = false;
      }, 100);

      return newPairs;
    });
  }, [selectedIds, uploadedFiles]);

  // ถ้ามีไฟล์ที่เคยอยู่ใน pair แต่ถูก unselect ออกจาก selectedIds ให้ลบทิ้ง
  useEffect(() => {
    setSelectedPairs((prev) => {
      const filtered = prev.filter(
        (p) => 
          selectedIds.includes(p.vcdId) && 
          selectedIds.includes(p.binId) &&
          (!p.linId || selectedIds.includes(p.linId))
      );
      return filtered;
    });
  }, [selectedIds]);

  // Auto-pair เมื่อ selectedIds เปลี่ยน (แต่ไม่ pair เมื่อ load config หรือกำลัง auto-pairing)
  useEffect(() => {
    if (!isLoadingConfigRef.current && !isAutoPairingRef.current && selectedIds.length > 0) {
      // ใช้ setTimeout เพื่อให้ state อัปเดตเสร็จก่อน
      const timer = setTimeout(() => {
        autoPairSmart();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [selectedIds, autoPairSmart]);

  // Load pairs data เมื่อ editJobId มีค่า (Edit Batch mode)
  useEffect(() => {
    if (editJobId) {
      const loadPairsFromJob = async () => {
        setIsLoadingPairs(true);
        isLoadingConfigRef.current = true; // ป้องกัน auto-pair ระหว่าง load
        
        try {
          const api = await import('../services/api');
          const response = await api.getJobPairs(editJobId);
          const pairsData = response.pairsData || [];
          
          // ถ้าไม่มี pairsData (job เก่าที่สร้างก่อน feature นี้) แสดง warning และให้ user สร้าง pairs ใหม่
          if (pairsData.length === 0) {
            addToast({ 
              type: 'warning', 
              message: 'No pairs data found for this batch. You can create new pairs manually.' 
            });
            setIsLoadingPairs(false);
            isLoadingConfigRef.current = false;
            return;
          }
          
          // Map file names กลับไปหา file IDs
          const loadedPairs = pairsData.map(pairData => {
            // หา file IDs จาก file names
            // Map file names กลับไปหา file IDs
            // pairsData เก็บ vcdId, binId, linId อยู่แล้ว แต่ถ้าไม่มีให้ใช้ file names
            let vcdFile = pairData.vcdId ? uploadedFiles.find(f => f.id === pairData.vcdId) : null;
            if (!vcdFile && pairData.vcdName) {
              vcdFile = uploadedFiles.find(f => f.name === pairData.vcdName || f.originalName === pairData.vcdName);
            }
            if (!vcdFile && pairData.vcd) {
              vcdFile = uploadedFiles.find(f => f.name === pairData.vcd || f.originalName === pairData.vcd);
            }
            
            let binFile = pairData.binId ? uploadedFiles.find(f => f.id === pairData.binId) : null;
            if (!binFile && pairData.binName) {
              binFile = uploadedFiles.find(f => f.name === pairData.binName || f.originalName === pairData.binName);
            }
            if (!binFile && pairData.erom) {
              binFile = uploadedFiles.find(f => f.name === pairData.erom || f.originalName === pairData.erom);
            }
            
            let linFile = null;
            if (pairData.linId) {
              linFile = uploadedFiles.find(f => f.id === pairData.linId);
            }
            if (!linFile && pairData.linName) {
              linFile = uploadedFiles.find(f => f.name === pairData.linName || f.originalName === pairData.linName);
            }
            if (!linFile && pairData.ulp) {
              linFile = uploadedFiles.find(f => f.name === pairData.ulp || f.originalName === pairData.ulp);
            }
            
            return {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              vcdId: vcdFile?.id || pairData.vcdId || '',
              binId: binFile?.id || pairData.binId || '',
              linId: linFile?.id || pairData.linId || null,
              try: pairData.try || pairData.try_count || 1,
              boardId: pairData.boardId ? (boards.find(b => b.id === pairData.boardId)?.id || boards.find(b => b.name === pairData.boardName)?.id) : null,
            };
          }).filter(pair => pair.vcdId && pair.binId); // กรองเฉพาะ pairs ที่มี VCD และ BIN
          
          if (loadedPairs.length > 0) {
            setSelectedPairs(loadedPairs);
            
            // Select files ที่ใช้ใน pairs
            const fileIdsToSelect = new Set();
            loadedPairs.forEach(pair => {
              if (pair.vcdId) fileIdsToSelect.add(pair.vcdId);
              if (pair.binId) fileIdsToSelect.add(pair.binId);
              if (pair.linId) fileIdsToSelect.add(pair.linId);
            });
            setSelectedIds(Array.from(fileIdsToSelect));
            
            // Load job data เพื่อ set config name, tag, boards
            const job = jobs.find(j => j.id === editJobId);
            if (job) {
              if (job.configName) setConfigName(job.configName);
              if (job.tag) setTag(job.tag);
              
              // Map board names กลับไปหา board IDs
              if (job.boards && job.boards.length > 0) {
                const boardIds = job.boards
                  .map(boardName => boards.find(b => b.name === boardName)?.id)
                  .filter(Boolean);
                setSelectedBoardIds(boardIds);
                setBoardSelectionMode('manual');
              } else {
                setBoardSelectionMode('auto');
              }
            }
                        } else {
                          addToast({ 
                            type: 'warning', 
                            message: 'No valid pairs found. Files may have been deleted. You can create new pairs manually.' 
                          });
                        }
                      } catch (error) {
                        console.error('Failed to load pairs from job', error);
                        // ถ้าเป็น 404 error แสดง message ที่เหมาะสม
                        if (error.response?.status === 404 || error.message?.includes('404')) {
                          addToast({ 
                            type: 'warning', 
                            message: 'No pairs data found for this batch. This batch was created before the edit feature was added. You can create new pairs manually.' 
                          });
                        } else {
                          addToast({ type: 'error', message: 'Failed to load pairs data from batch.' });
                        }
                      } finally {
                        setIsLoadingPairs(false);
                        isLoadingConfigRef.current = false;
                      }
      };
      
      loadPairsFromJob();
    }
  }, [editJobId, uploadedFiles, jobs, boards]);

  const addPair = () => {
    if (!selectedPairVcdId || !selectedPairBinId) return;
    // ป้องกัน duplicate คู่เดิม
    const exists = selectedPairs.some(
      (p) => p.vcdId === selectedPairVcdId && p.binId === selectedPairBinId && p.linId === selectedPairLinId
    );
    if (exists) return;
    setSelectedPairs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        vcdId: selectedPairVcdId,
        binId: selectedPairBinId,
        linId: selectedPairLinId || null, // lin is optional
        try: 1, // default จำนวนรอบ test
        boardId: null,
      },
    ]);
    setSelectedPairVcdId('');
    setSelectedPairBinId('');
    setSelectedPairLinId('');
  };

  const pairAll = () => {
    if (vcdFilesList.length === 0 || binFilesList.length === 0) {
      addToast({ type: 'warning', message: 'Please select at least one VCD and one BIN file first' });
      return;
    }

    const newPairs = [];
    // ใช้ลำดับจาก selectedFiles (ตาม selectedIds order) เพื่อ pair ตามที่ user เรียงไว้
    // selectedFiles ถูกเรียงตาม selectedIds order อยู่แล้ว
    const orderedFiles = selectedFiles; // ใช้ลำดับที่ user เรียงไว้
    
    // หา VCD, BIN, LIN ตามลำดับที่เรียงไว้
    const orderedVcds = orderedFiles.filter(f => getFileKind(f) === 'vcd');
    const orderedBins = orderedFiles.filter(f => getFileKind(f) === 'bin');
    const orderedLins = orderedFiles.filter(f => {
      const ext = String(f?.name || '').split('.').pop()?.toLowerCase();
      return ext === 'lin' || ext === 'txt' || ext === 'ulp';
    });

    // Pair ตามลำดับที่เรียงไว้: VCD กับ BIN ที่อยู่ใกล้กันที่สุด
    // ถ้ามี VCD, ULM, EROM ติดกัน ให้ pair เป็นกลุ่ม
    orderedVcds.forEach((vcdFile, vcdIdx) => {
      // หา BIN ที่ใกล้ที่สุด (ใช้ BIN ที่มี index ใกล้กับ VCD index ใน orderedFiles)
      const vcdIndexInOrdered = orderedFiles.findIndex(f => f.id === vcdFile.id);
      
      // หา BIN ที่ใกล้ที่สุด (ถ้ามีหลาย BIN ให้ใช้ตัวที่ใกล้ที่สุด)
      let nearestBin = null;
      let minDistance = Infinity;
      
      orderedBins.forEach(binFile => {
        const binIndexInOrdered = orderedFiles.findIndex(f => f.id === binFile.id);
        const distance = Math.abs(binIndexInOrdered - vcdIndexInOrdered);
        if (distance < minDistance) {
          minDistance = distance;
          nearestBin = binFile;
        }
      });

      // ถ้าไม่เจอ BIN ที่ใกล้ ให้ใช้ BIN แรก
      const binFile = nearestBin || orderedBins[vcdIdx % orderedBins.length];
      
      // หา LIN ที่ใกล้ที่สุด (ถ้ามี)
      let nearestLin = null;
      let minLinDistance = Infinity;
      
      orderedLins.forEach(linFile => {
        const linIndexInOrdered = orderedFiles.findIndex(f => f.id === linFile.id);
        const distance = Math.abs(linIndexInOrdered - vcdIndexInOrdered);
        if (distance < minLinDistance) {
          minLinDistance = distance;
          nearestLin = linFile;
        }
      });

      const exists = selectedPairs.some(
        (p) => p.vcdId === vcdFile.id && p.binId === binFile.id
      );
      
      if (!exists) {
        newPairs.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}-${vcdIdx}`,
          vcdId: vcdFile.id,
          binId: binFile.id,
          linId: nearestLin?.id || null, // pair LIN ที่ใกล้ที่สุดถ้ามี
          try: 1,
          boardId: null, // เลือกบอร์ดรันแยกต่อ test case ได้ (null = ใช้ตาม batch)
        });
      }
    });

    if (newPairs.length > 0) {
      setSelectedPairs((prev) => [...prev, ...newPairs]);
      addToast({ type: 'success', message: `Created ${newPairs.length} pair(s) based on file order` });
    } else {
      addToast({ type: 'info', message: 'All possible pairs already exist' });
    }
  };

  const clearAllPairs = () => {
    if (selectedPairs.length === 0) {
      addToast({ type: 'info', message: 'No pairs to clear' });
      return;
    }
    if (window.confirm(`Are you sure you want to clear all ${selectedPairs.length} pair(s)?`)) {
      // ตั้ง flag เพื่อป้องกัน auto-pair ทันที
      isAutoPairingRef.current = true;
      setSelectedPairs([]);
      setSelectedTestCaseIds([]);
      addToast({ type: 'success', message: 'All pairs cleared' });
      
      // Reset flag หลังจาก clear เสร็จ (ไม่ auto-pair ใหม่ ให้ user กด Pair All เอง)
      setTimeout(() => {
        isAutoPairingRef.current = false;
      }, 500);
    }
  };

  const removePair = (id) => {
    setSelectedPairs((prev) => prev.filter((p) => p.id !== id));
    setSelectedTestCaseIds((prev) => prev.filter((testId) => testId !== id));
  };

  const duplicatePair = (id) => {
    const pair = selectedPairs.find((p) => p.id === id);
    if (!pair) return;
    const newPair = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      vcdId: pair.vcdId,
      binId: pair.binId,
      linId: pair.linId,
      try: pair.try || 1,
      boardId: pair.boardId ?? null,
    };
    const pairIndex = selectedPairs.findIndex((p) => p.id === id);
    setSelectedPairs((prev) => {
      const next = [...prev];
      next.splice(pairIndex + 1, 0, newPair);
      return next;
    });
    addToast({ type: 'success', message: 'Test case duplicated' });
  };

  // Move pair up/down in the list
  const movePair = (pairId, direction) => {
    const currentIndex = selectedPairs.findIndex((p) => p.id === pairId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= selectedPairs.length) return;

    setSelectedPairs((prev) => {
      const newPairs = [...prev];
      const [movedPair] = newPairs.splice(currentIndex, 1);
      newPairs.splice(targetIndex, 0, movedPair);
      return newPairs;
    });
  };

  const toggleTestCaseSelection = (id) => {
    setSelectedTestCaseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllTestCases = () => {
    if (selectedTestCaseIds.length === selectedPairs.length) {
      setSelectedTestCaseIds([]);
    } else {
      setSelectedTestCaseIds(selectedPairs.map((p) => p.id));
    }
  };

  // Bulk Edit: Set try count for selected test cases
  const handleBulkSetTryCount = () => {
    if (selectedTestCaseIds.length === 0) {
      addToast({ type: 'warning', message: 'Please select at least one test case.' });
      return;
    }

    const tryCount = parseInt(bulkTryCount);
    if (isNaN(tryCount) || tryCount < 1) {
      addToast({ type: 'error', message: 'Please enter a valid number (minimum 1).' });
      return;
    }

    setSelectedPairs(prevPairs => 
      prevPairs.map(pair => 
        selectedTestCaseIds.includes(pair.id)
          ? { ...pair, try: tryCount }
          : pair
      )
    );

    addToast({ 
      type: 'success', 
      message: `Set try count to ${tryCount} for ${selectedTestCaseIds.length} test case(s).` 
    });
    setBulkTryCount(''); // Clear input after applying
  };

  const updatePairTry = (pairId, tryCount) => {
    // อนุญาตให้เป็น empty string เพื่อให้ผู้ใช้ลบได้
    if (tryCount === '' || tryCount === null || tryCount === undefined) {
      setSelectedPairs((prev) =>
        prev.map((p) => (p.id === pairId ? { ...p, try: '' } : p))
      );
      return;
    }
    // ถ้ามีค่า ให้ parse และ validate
    const num = parseInt(tryCount);
    if (isNaN(num)) {
      // ถ้า parse ไม่ได้ ให้เก็บเป็น empty string
      setSelectedPairs((prev) =>
        prev.map((p) => (p.id === pairId ? { ...p, try: '' } : p))
      );
      return;
    }
    // จำกัด 1-100
    const count = Math.max(1, Math.min(100, num));
    setSelectedPairs((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, try: count } : p))
    );
  };

  const updatePairBoard = (pairId, boardId) => {
    setSelectedPairs((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, boardId: boardId || null } : p))
    );
  };

  const updatePairFile = (pairId, fileType, fileId) => {
    setSelectedPairs((prev) =>
      prev.map((p) => {
        if (p.id !== pairId) return p;
        const updated = { ...p };
        if (fileType === 'vcd') updated.vcdId = fileId;
        else if (fileType === 'bin') updated.binId = fileId;
        else if (fileType === 'lin') updated.linId = fileId || null;
        return updated;
      })
    );
  };

  const reorderList = (arr, fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= arr.length || toIndex >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    next.splice(insertAt, 0, item);
    return next;
  };

  const handleRowDragStart = (e, index) => {
    draggingRowIndexRef.current = index;
    setDraggingRowIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleRowDragOver = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetRowIndex(index);
  };

  const handleRowDrop = (e, toIndex) => {
    e.preventDefault();
    e.stopPropagation();
    const fromIndex = draggingRowIndexRef.current;
    if (fromIndex == null) return;
    if (selectedPairs.length > 0) {
      setSelectedPairs((prev) => reorderList(prev, fromIndex, toIndex));
    } else {
      setSelectedIds((prev) => reorderList(prev, fromIndex, toIndex));
    }
    draggingRowIndexRef.current = null;
    setDraggingRowIndex(null);
    setDropTargetRowIndex(null);
  };

  const handleRowDragEnd = () => {
    draggingRowIndexRef.current = null;
    setDraggingRowIndex(null);
    setDropTargetRowIndex(null);
  };

  // Save config to JSON file (เก็บ configName, tag, pairs และ fileNames — โหลดกลับมาแสดงไฟล์ได้)
  const saveConfigJson = () => {
    const config = {
      configName,
      tag,
      pairs: selectedPairs.map((p) => {
        const vcdFile = uploadedFiles.find((f) => f.id === p.vcdId);
        const binFile = uploadedFiles.find((f) => f.id === p.binId);
        const linFile = p.linId ? uploadedFiles.find((f) => f.id === p.linId) : null;
        return {
          vcd: vcdFile?.name || '',
          bin: binFile?.name || '',
          lin: linFile?.name || null,
          try: p.try || 1,
        };
      }),
      fileNames: selectedFiles.map((f) => f.name),
      createdAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${configName || 'config'}_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Config saved successfully!' });
  };

  // Load config from JSON — โหลด pairs และ/หรือ fileNames แล้ว auto-select ไฟล์ที่พบใน library
  const loadConfigJson = async (file) => {
    try {
      isLoadingConfigRef.current = true; // ตั้ง flag ว่าเป็นการ load config
      const text = await file.text();
      const config = JSON.parse(text);

      const pairs = Array.isArray(config.pairs) ? config.pairs : [];
      const newPairs = [];
      const idsToSelect = new Set(selectedIds);

      for (const pair of pairs) {
        const vcdFile = uploadedFiles.find((f) => f.name === pair.vcd);
        const binFile = uploadedFiles.find((f) => f.name === pair.bin);
        const linFile = pair.lin ? uploadedFiles.find((f) => f.name === pair.lin) : null;

        if (!vcdFile || !binFile) {
          addToast({ 
            type: 'warning', 
            message: `Skipped pair: ${pair.vcd} / ${pair.bin} — files not found in library (add files first)` 
          });
          continue;
        }

        idsToSelect.add(vcdFile.id);
        idsToSelect.add(binFile.id);
        if (linFile) idsToSelect.add(linFile.id);

        newPairs.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          vcdId: vcdFile.id,
          binId: binFile.id,
          linId: linFile?.id || null,
          try: pair.try || 1,
        });
      }

      // โหลด fileNames (รายการไฟล์ที่เลือก) — แม้ไม่มี pairs ก็แสดงในตารางได้
      let loadedFromFileNames = 0;
      if (Array.isArray(config.fileNames)) {
        for (const name of config.fileNames) {
          const f = uploadedFiles.find((x) => x.name === name);
          if (f && !idsToSelect.has(f.id)) {
            idsToSelect.add(f.id);
            loadedFromFileNames++;
          }
        }
      }

      setSelectedIds([...idsToSelect]);
      setSelectedPairs(newPairs);
      if (config.configName) setConfigName(config.configName);
      if (config.tag) setTag(config.tag);

      if (newPairs.length > 0) {
        addToast({ type: 'success', message: `Loaded ${newPairs.length} pair(s) and selected related files` });
      } else if (loadedFromFileNames > 0) {
        addToast({ type: 'success', message: `Loaded config and selected ${loadedFromFileNames} file(s)` });
      } else if (pairs.length === 0 && (!config.fileNames || config.fileNames.length === 0)) {
        addToast({ type: 'success', message: 'Loaded config (configName, tag)' });
      } else if (pairs.length > 0) {
        addToast({ type: 'warning', message: 'Loaded 0 pairs — check that config files exist in library (add files first)' });
      } else {
        addToast({ type: 'warning', message: 'Config files not found in library — add files first then load again' });
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      addToast({ type: 'error', message: `Failed to load config: ${error.message}` });
    } finally {
      isLoadingConfigRef.current = false; // reset flag
    }
  };

  const handleJsonDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDraggingJson(true);
  };

  const handleJsonDragLeave = (e) => {
    e.preventDefault();
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDraggingJson(false);
  };

  const handleJsonDrop = (e) => {
    e.preventDefault();
    setIsDraggingJson(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const jsonFile = files.find((f) => f.name.endsWith('.json'));
    if (jsonFile) {
      loadConfigJson(jsonFile);
    } else {
      addToast({ type: 'warning', message: 'Please drop a JSON file' });
    }
  };

  const handleJsonFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith('.json')) {
      loadConfigJson(file);
    } else {
      addToast({ type: 'warning', message: 'Please select a JSON file' });
    }
    if (jsonInputRef.current) jsonInputRef.current.value = '';
  };

  const handleFileSelect = async (selectedFiles) => {
    const filesArray = Array.from(selectedFiles);
    await useTestStore.getState().refreshFiles?.();
    const currentFiles = useTestStore.getState().uploadedFiles || [];
    const byChecksum = new Map(currentFiles.filter((f) => f.checksum).map((f) => [f.checksum, f]));

    const prepared = [];
    for (const file of filesArray) {
      const extension = file.name.split('.').pop().toLowerCase();
      const validExtensions = ['vcd', 'bin', 'hex', 'elf', 'erom', 'ulp'];
      if (!validExtensions.includes(extension)) {
        pushFileError(`File type .${extension} is not supported. Please upload .vcd, .bin, .hex, .elf, .erom, or .ulp files.`);
        continue;
      }
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        pushFileError(`File ${file.name} is too large. Maximum size is 50MB.`);
        continue;
      }
      const sig = await computeFileSignature(file);
      let existing = null;
      if (sig.checksum) {
        try {
          const res = await api.checkFile({
            filename: file.name,
            signature: sig.checksum,
            size: sig.size,
            modifyDate: sig.modifiedAt,
          });
          if (res.duplicate && res.existing) existing = res.existing;
        } catch {
          existing = byChecksum.get(sig.checksum) || null;
        }
        if (!existing) existing = byChecksum.get(sig.checksum) || null;
      }
      prepared.push({ file, sig, existing });
    }

    const duplicates = prepared.filter((p) => p.existing);
    if (duplicates.length > 0) {
      setUploadChoiceModal({ prepared });
      return;
    }
    for (const p of prepared) {
      await addUploadedFile(p.file);
    }
  };

  const handleUploadChoiceConfirm = async (choices) => {
    if (!uploadChoiceModal?.prepared) return;
    const prepared = uploadChoiceModal.prepared;
    let uploaded = 0;
    const reusedIds = [];
    for (const p of prepared) {
      const choice = choices[p.file.name];
      if (p.existing && choice === 'reuse') {
        reusedIds.push(p.existing.id);
        continue;
      }
      const forceNew = p.existing && choice === 'upload';
      const result = await addUploadedFile(p.file, forceNew ? { forceNew: true } : {});
      if (result) uploaded++;
    }
    setUploadChoiceModal(null);
    if (reusedIds.length > 0) setSelectedIds((prev) => [...new Set([...prev, ...reusedIds])]);
    if (uploaded > 0) addToast({ type: 'success', message: `${uploaded} file(s) uploaded` });
    if (reusedIds.length > 0) addToast({ type: 'info', message: `${reusedIds.length} file(s) reused from library` });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're actually leaving the container
    // (not just moving to a child element)
    if (!e.currentTarget.contains(e.relatedTarget)) {
    setIsDragging(false);
    }
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  };
  
  const handleFileInputChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
    // Reset input to allow selecting the same file again
    e.target.value = '';
  };
  
  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  useEffect(() => {
    if (selectedIds.length > 0 && setupErrors.files) {
      setSetupErrors((prev) => ({ ...prev, files: '' }));
    }
  }, [selectedIds, setupErrors.files]);

  useEffect(() => {
    if ((boardSelectionMode === 'auto' || selectedBoardIds.length > 0) && setupErrors.boards) {
      setSetupErrors((prev) => ({ ...prev, boards: '' }));
    }
  }, [boardSelectionMode, selectedBoardIds, setupErrors.boards]);

  useEffect(() => {
    if (selectedTestCommand && setupErrors.command) {
      setSetupErrors((prev) => ({ ...prev, command: '' }));
    }
  }, [selectedTestCommand, setupErrors.command]);

  useEffect(() => {
    setSetupErrors((prev) => ({
      ...prev,
      files: setupMode === 'files' ? prev.files : '',
      command: setupMode === 'commands' ? prev.command : ''
    }));
  }, [setupMode]);

  // Auto-select ไฟล์ทั้งหมดทุกครั้งที่มีการเพิ่มไฟล์ใหม่ (drop / browse)
  // เมื่อจำนวนไฟล์เพิ่ม → เลือกครบทุกไฟล์; หลังจากนั้นผู้ใช้ยัง check / uncheck เองได้
  useEffect(() => {
    const prevCount = prevUploadedCountRef.current;
    const currCount = uploadedFiles.length;

    if (currCount > prevCount && !isLoadingConfigRef.current) {
      setSelectedIds(uploadedFiles.map((f) => f.id));
    }

    prevUploadedCountRef.current = currCount;
  }, [uploadedFiles, selectedIds.length]);
  
    // ฟังก์ชันเลือก/ไม่เลือก ทั้งหมด
    const handleSelectAll = () => {
    if (selectedIds.length === uploadedFiles.length) {
      setSelectedIds([]);
      } else {
      setSelectedIds(uploadedFiles.map(f => f.id));
      }
    };
  
    // ฟังก์ชันเลือกเฉพาะไฟล์
    const toggleSelect = (id) => {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter(item => item !== id));
      } else {
        setSelectedIds([...selectedIds, id]);
      }
    };
  
    // ฟังก์ชันลบไฟล์ที่เลือก (ลบไฟล์จริงๆ)
    const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} file(s)?\n\nThis will permanently delete the files from the server.`)) {
      try {
        setIsDeletingFiles(true);
        await Promise.all(selectedIds.map(id => removeUploadedFile(id)));
        setSelectedIds([]);
        addToast({ type: 'success', message: 'Files deleted successfully.' });
      } catch (error) {
        console.error('Failed to delete files', error);
        addToast({ type: 'error', message: 'Failed to delete files.' });
      } finally {
        setIsDeletingFiles(false);
      }
      }
    };

    // ฟังก์ชันเคลียร์ space (เคลียร์เฉพาะ UI state ไม่ลบไฟล์จริง)
    const handleClearAll = () => {
      if (selectedIds.length === 0 && selectedPairs.length === 0) {
        addToast({ type: 'info', message: 'Nothing to clear.' });
        return;
      }
      
      if (window.confirm(`Clear all selections and pairs?\n\nThis will only clear the UI. Files will remain in the upload folder.`)) {
        setSelectedIds([]);
        setSelectedPairs([]);
        setSelectedTestCaseIds([]);
        setSelectedPairVcdId('');
        setSelectedPairBinId('');
        setSelectedPairLinId('');
        addToast({ type: 'success', message: 'Cleared all selections. Files remain in upload folder.' });
      }
    };

    // Start fresh  ลบไฟล์ทั้งหมดจาก server + เคลียร์ UI
    const handleStartFresh = async () => {
      if (uploadedFiles.length === 0) {
        addToast({ type: 'info', message: 'No files to clear. Already fresh.' });
        return;
      }
      if (!window.confirm(`Delete all ${uploadedFiles.length} file(s) from the server and clear the list?\n\nUse this to start a clean demo.`)) return;
      try {
        setIsDeletingFiles(true);
        await Promise.all(uploadedFiles.map((f) => removeUploadedFile(f.id)));
        setSelectedIds([]);
        setSelectedPairs([]);
        setSelectedTestCaseIds([]);
        setSelectedPairVcdId('');
        setSelectedPairBinId('');
        setSelectedPairLinId('');
        addToast({ type: 'success', message: 'All files cleared. Ready for a fresh demo.' });
      } catch (error) {
        console.error('Failed to clear all files', error);
        addToast({ type: 'error', message: 'Failed to clear some files.' });
      } finally {
        setIsDeletingFiles(false);
      }
    };

  return (
  <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 sm:space-y-8">
    <UploadChoiceModal
      open={!!uploadChoiceModal?.prepared?.length}
      prepared={uploadChoiceModal?.prepared ?? []}
      onConfirm={handleUploadChoiceConfirm}
      onCancel={() => setUploadChoiceModal(null)}
    />
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between sm:items-end gap-4">
      <div className="min-w-0">
    <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100">
      {editJobId ? `Edit Set #${editJobId}` : 'Test Case Setup'}
    </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm sm:text-base">
          {editJobId 
            ? 'Edit pairs and configuration for this batch' 
            : 'Configure and manage your test files or use pre-written test commands.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
      {editJobId && (
        <button
          onClick={() => {
            if (onEditComplete) onEditComplete();
            // Reset states
            setSelectedPairs([]);
            setSelectedIds([]);
            setSelectedBoardIds([]);
            setSelectedTestCaseIds([]);
            setConfigName('Default_Setup');
            setTag('');
          }}
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-200 transition-all flex items-center gap-2"
        >
          <X size={16} />
          Cancel Edit
        </button>
      )}
          <div className="flex gap-2 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setSetupMode('files')}
              className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                setupMode === 'files' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              File Upload
            </button>
          </div>
      </div>
        </div>
  
        <div className="max-w-6xl mx-auto min-w-0">
          <div className="space-y-6">
            {/* ส่วนแสดงรายการไฟล์พร้อมระบบเลือก */}
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm overflow-hidden transition-all"
            >
              <div className="p-3 sm:p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    checked={selectedIds.length === uploadedFiles.length && uploadedFiles.length > 0}
                    onChange={handleSelectAll}
                  />
                  <span className="text-sm font-bold text-slate-600 uppercase tracking-wider">
                    Select All ({selectedIds.length}/{uploadedFiles.length})
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  {/* Clear All Button - Clear UI only, don't delete files */}
                  {(selectedIds.length > 0 || selectedPairs.length > 0) && (
                    <button 
                      onClick={handleClearAll}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold transition-colors hover:bg-slate-200"
                      title="Clear all selections and pairs (files remain in upload folder)"
                    >
                      <X size={14} />
                      Clear All
                    </button>
                  )}
                  
                  {/* Delete Selected Button - Actually delete files */}
                  {selectedIds.length > 0 && (
                    <button 
                      onClick={handleDeleteSelected}
                      disabled={isDeletingFiles}
                      className={`flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-bold transition-colors animate-in fade-in zoom-in duration-200 ${isDeletingFiles ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-100'}`}
                      title="Permanently delete selected files from server"
                    >
                      {isDeletingFiles ? 'Deleting...' : '❌ Delete Selected'}
                    </button>
                  )}

                  {/* Start fresh - ลบไฟล์ทั้งหมด สำหรับเริ่มเดโม่ใหม่ */}
                  {uploadedFiles.length > 0 && (
                    <button 
                      onClick={handleStartFresh}
                      disabled={isDeletingFiles}
                      className={`flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold transition-colors ${isDeletingFiles ? 'opacity-60 cursor-not-allowed' : 'hover:bg-amber-100'}`}
                      title="Delete all files and clear list (for a fresh demo)"
                    >
                      {isDeletingFiles ? 'Clearing...' : 'Start fresh'}
                    </button>
                  )}
                </div>
              </div>
  
              {/* Compact add-files (+) */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".vcd,.bin,.hex,.elf,.erom,.ulp"
                onChange={handleFileInputChange}
                className="hidden"
              />
  
              {/* Filter: All/VCD/ERoM/ULP + Time, File Name, Tag */}
              <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white">
                <div className="flex items-center gap-2">
                  {[
                    { key: 'all', label: 'All' },
                    { key: 'vcd', label: 'VCD' },
                    { key: 'bin', label: 'ERoM' },
                    { key: 'lin', label: 'ULP' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setFileFilter(opt.key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        fileFilter === opt.key
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={handleBrowseClick}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    title="Add files"
                  >
                    <Plus size={16} />
                  </button>
                  <input
                    type="text"
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    placeholder="Search name..."
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:border-blue-300 focus:ring-0"
                  />
                  <select
                    value={fileSort}
                    onChange={(e) => setFileSort(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-700 shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 appearance-none"
                  >
                    <option value="time">Time</option>
                    {/* <option value="file-name">File Name</option> */}
                    <option value="tag">Tag</option>
                    {/* <option value="name-asc">Name A-Z</option>
                    <option value="name-desc">Name Z-A</option> */}
                  </select>
                </div>
              </div>
  
              <div className={`divide-y divide-slate-100 overflow-y-auto relative transition-[max-height] duration-300 ${
                fileListExpanded ? 'max-h-[500px]' : 'max-h-[220px]'
              }`}>
                {loading?.files ? (
                  <div className="p-12 text-center text-slate-400">
                    <p>Loading files...</p>
                  </div>
                ) : errors?.files ? (
                  <div className="p-12 text-center text-red-600">
                    <p>Failed to load files: {errors.files}</p>
                  </div>
                ) : uploadedFiles.length > 0 ? (
                  [...uploadedFiles]
                    .filter((file) => {
                      // Filter by file type (All/VCD/ERoM/ULP)
                      const kind = getFileKind(file);
                      if (fileFilter === 'all') {
                        // pass all
                      } else if (fileFilter === 'vcd') {
                        if (kind !== 'vcd') return false;
                      } else if (fileFilter === 'bin') {
                        if (kind !== 'bin') return false;
                      } else if (fileFilter === 'lin') {
                        if (kind !== 'lin') return false;
                      }
                      
                      // Filter by search
                      if (!fileSearch.trim()) return true;
                      return file.name.toLowerCase().includes(fileSearch.trim().toLowerCase());
                    })
                    .sort((a, b) => {
                      if (fileSort === 'time') {
                        // Sort by upload date (newest first)
                        return (new Date(b.uploadDate || b.date || 0)) - (new Date(a.uploadDate || a.date || 0));
                      }
                      if (fileSort === 'file-name') {
                        // Sort by file name A-Z
                        return a.name.localeCompare(b.name);
                      }
                      if (fileSort === 'tag') {
                        // Sort by tag if available, otherwise by name
                        const aTag = a.tag || '';
                        const bTag = b.tag || '';
                        if (aTag && bTag) return aTag.localeCompare(bTag);
                        if (aTag) return -1;
                        if (bTag) return 1;
                        return a.name.localeCompare(b.name);
                      }
                      if (fileSort === 'name-asc') {
                        return a.name.localeCompare(b.name);
                      }
                      if (fileSort === 'name-desc') {
                        return b.name.localeCompare(a.name);
                      }
                      return 0;
                    })
                    .map((file) => (
                    <div 
                      key={file.id} 
                      className={`flex items-center gap-4 p-4 transition-colors hover:bg-slate-50 ${selectedIds.includes(file.id) ? 'bg-blue-50/50' : ''}`}
                    >
                      <input 
                        type="checkbox" 
                        className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        checked={selectedIds.includes(file.id)}
                        onChange={() => toggleSelect(file.id)}
                      />
                      <div className="p-2 bg-white rounded-lg border border-slate-200">
                        <FileCode size={20} className={file.type === 'vcd' ? 'text-blue-500' : 'text-orange-500'} />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-slate-700">{file.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="text-[10px] text-slate-400 font-bold uppercase">{file.sizeFormatted || file.size}</div>
                          <span className="text-[10px] text-slate-400">•</span>
                          <div className="text-[10px] text-slate-400">{file.date}</div>
                          {file.originalName !== file.name && (
                            <>
                              <span className="text-[10px] text-slate-400">•</span>
                              <div className="text-[10px] text-blue-500" title={`Original: ${file.originalName}`}>
                                Renamed
                      </div>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (window.confirm(`Delete ${file.name}?\n\nThis will permanently delete the file from the server.`)) {
                            await removeUploadedFile(file.id);
                            addToast({ type: 'success', message: `File ${file.name} deleted.` });
                          }
                        }}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        title="Permanently delete file from server"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center text-slate-400">
                    <p>No files uploaded yet.</p>
                    <p className="text-xs mt-2">Drag and drop files here or use the + button above</p>
                  </div>
                )}
              </div>

              {/* Show more / Show less */}
              {uploadedFiles.length > 0 && !loading?.files && !errors?.files && (
                <button
                  type="button"
                  onClick={() => setFileListExpanded((e) => !e)}
                  className="w-full py-2.5 flex items-center justify-center gap-2 text-xs font-bold text-slate-600 hover:bg-slate-50 border-t border-slate-200 transition-colors"
                >
                  {fileListExpanded ? (
                    <>
                      <ChevronUp size={14} />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} />
                      Show more
                    </>
                  )}
                </button>
              )}
            </div>
            
            {setupMode === 'files' ? (
              <>
            {setupErrors.files && (
              <div className="text-sm text-red-600 px-2">
                {setupErrors.files}
              </div>
            )}
  
                {fileValidationErrors.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {fileValidationErrors.map((msg, index) => (
                      <div key={`${msg}-${index}`}>{msg}</div>
                    ))}
                  </div>
                )}

                {/* Select — ลากไฟล์ .json มาวางที่แผนที่นี้ได้ หรือใช้ LOAD CONFIG. JSON */}
                <div
                  onDragOver={handleJsonDragOver}
                  onDragLeave={handleJsonDragLeave}
                  onDrop={handleJsonDrop}
                  title="Drag and drop .json file to load config"
                  className={`bg-white rounded-3xl border shadow-sm overflow-hidden transition-all ${
                    isDraggingJson ? 'border-blue-500 ring-2 ring-blue-300 ring-offset-2' : 'border-slate-200'
                  }`}
                >
                  <input ref={jsonInputRef} type="file" accept=".json" onChange={handleJsonFileInput} className="hidden" />
                  <div className="p-4 flex flex-col gap-3 border-b border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-slate-900">
                              {editJobId ? `Edit Set #${editJobId}` : 'Pair Files'}
                            </h3>
                            {selectedPairs.length > 0 && (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">
                                {selectedPairs.length} pairs
                              </span>
                            )}
                            {isLoadingPairs && (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold flex items-center gap-1">
                                <RefreshCw size={12} className="animate-spin" />
                                Loading...
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">    
                            {editJobId ? '' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedPairVcdId}
                            onChange={(e) => setSelectedPairVcdId(e.target.value)}
                            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-700 shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 appearance-none"
                          >
                            <option value="">Select VCD</option>
                            {vcdFilesList.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                          <select
                            value={selectedPairBinId}
                            onChange={(e) => setSelectedPairBinId(e.target.value)}
                            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-700 shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 appearance-none"
                          >
                            <option value="">Select ERoM</option>
                            {binFilesList.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                          <select
                            value={selectedPairLinId}
                            onChange={(e) => setSelectedPairLinId(e.target.value)}
                            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-700 shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 appearance-none"
                          >
                            <option value="">Select ULP </option>
                            {linFilesList.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={addPair}
                            disabled={!selectedPairVcdId || !selectedPairBinId}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                              !selectedPairVcdId || !selectedPairBinId
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            Add pair
                          </button>
              </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={pairAll}
                            disabled={vcdFilesList.length === 0 || binFilesList.length === 0}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
                              vcdFilesList.length === 0 || binFilesList.length === 0
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                            title="Pair all VCD files with BIN files automatically"
                          >
                            <Layers size={14} />
                            Pair All
                          </button>
                          <button
                            onClick={clearAllPairs}
                            disabled={selectedPairs.length === 0}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
                              selectedPairs.length === 0
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-red-600 text-white hover:bg-red-700'
                            }`}
                            title="Clear all pairs"
                          >
                            <X size={14} />
                            Clear
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={saveConfigJson}
                            className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700"
                          >
                            <FileJson size={14} />
                            SAVE CONFIG. JSON
                          </button>
                          <button
                            onClick={() => jsonInputRef.current?.click()}
                            className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-2"
                          >
                            <FileJson size={14} />
                            LOAD CONFIG. JSON
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                      {selectedIds.length > 0 ? (
                        <>
                          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-slate-900">Test Case</h4>
                              {/* Bulk Edit Try Count */}
                              {selectedTestCaseIds.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-600 font-semibold">
                                    {selectedTestCaseIds.length} selected
                                  </span>
                                  <input
                                    type="number"
                                    min="1"
                                    value={bulkTryCount}
                                    onChange={(e) => setBulkTryCount(e.target.value)}
                                    placeholder="Try count"
                                    className="w-20 px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleBulkSetTryCount();
                                      }
                                    }}
                                  />
                                  <button
                                    onClick={handleBulkSetTryCount}
                                    className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 transition-all"
                                    title="Apply try count to selected test cases"
                                  >
                                    Apply
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="grid bg-slate-200 dark:bg-slate-700 text-xs font-bold text-black dark:text-white border border-slate-300 dark:border-slate-600 rounded-t-lg" style={{ gridTemplateColumns: '40px 40px 1fr 1fr 1fr 100px 110px 120px' }}>
                            <div className="px-2 py-2.5 flex items-center justify-center border-r border-slate-300 dark:border-slate-600">
                              <input
                                type="checkbox"
                                checked={selectedTestCaseIds.length === selectedPairs.length && selectedPairs.length > 0}
                                onChange={toggleSelectAllTestCases}
                                className="w-4 h-4 rounded border-slate-400 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                title="Select all"
                              />
                            </div>
                            <div className="px-2 py-2.5 text-center border-r border-slate-300 dark:border-slate-600">#</div>
                            <div className="px-3 py-2.5 border-r border-slate-300 dark:border-slate-600">VCD</div>
                            <div className="px-3 py-2.5 border-r border-slate-300 dark:border-slate-600">ERoM</div>
                            <div className="px-3 py-2.5 border-r border-slate-300 dark:border-slate-600">ULP</div>
                            <div className="px-2 py-2.5 text-center border-r border-slate-300 dark:border-slate-600">try</div>
                            <div className="px-2 py-2.5 border-r border-slate-300 dark:border-slate-600">Board</div>
                            <div className="px-3 py-2.5 text-center">Actions</div>
                          </div>
                          {selectedPairs.map((pair, idx) => {
                            const vcdName = vcdFilesList.find((f) => f.id === pair.vcdId)?.name || '—';
                            const binName = binFilesList.find((f) => f.id === pair.binId)?.name || '—';
                            const linName = pair.linId ? linFilesList.find((f) => f.id === pair.linId)?.name || '—' : '—';
                            return (
                              <div
                                key={pair.id}
                                onDragEnter={(e) => e.preventDefault()}
                                onDragOver={(e) => handleRowDragOver(e, idx)}
                                onDrop={(e) => handleRowDrop(e, idx)}
                                onClick={(e) => {
                                  // ไม่ toggle selection ถ้าคลิกที่ button, input, select, หรือ draggable element
                                  if (e.target.closest('button') || 
                                      e.target.closest('input') || 
                                      e.target.closest('select') || 
                                      e.target.closest('[draggable]')) {
                                    return;
                                  }
                                  toggleTestCaseSelection(pair.id);
                                }}
                                className={`grid items-center text-sm border border-slate-300 dark:border-slate-600 border-t-0 cursor-pointer text-black dark:text-white bg-white dark:bg-slate-800/50 ${idx === selectedPairs.length - 1 ? 'rounded-b-lg' : ''} ${draggingRowIndex === idx ? 'opacity-50' : ''} ${dropTargetRowIndex === idx ? 'ring-1 ring-blue-400 bg-blue-50 dark:bg-blue-900/30' : ''} ${selectedTestCaseIds.includes(pair.id) ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                                style={{ gridTemplateColumns: '40px 40px 1fr 1fr 1fr 100px 110px 120px' }}
                              >
                                <div 
                                  className="px-2 py-2 flex items-center justify-center border-r border-slate-300 dark:border-slate-600"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedTestCaseIds.includes(pair.id)}
                                    onChange={() => toggleTestCaseSelection(pair.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-4 h-4 rounded border-slate-400 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                </div>
                                <div 
                                  className="px-2 py-2 text-black dark:text-slate-200 text-center font-medium border-r border-slate-300 dark:border-slate-600"
                                >
                                  {idx + 1}
                                </div>
                                <div 
                                  className="px-3 py-2 border-r border-slate-300 dark:border-slate-600"
                                >
                                  <select
                                    value={pair.vcdId || ''}
                                    onChange={(e) => updatePairFile(pair.id, 'vcd', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-black dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                                  >
                                    <option value="">— Select VCD —</option>
                                    {vcdFilesList.map((f) => (
                                      <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div 
                                  className="px-3 py-2 border-r border-slate-300 dark:border-slate-600"
                                >
                                  <select
                                    value={pair.binId || ''}
                                    onChange={(e) => updatePairFile(pair.id, 'bin', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-black dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                                  >
                                    <option value="">— Select ERoM —</option>
                                    {binFilesList.map((f) => (
                                      <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div 
                                  className="px-3 py-2 border-r border-slate-300 dark:border-slate-600"
                                >
                                  <select
                                    value={pair.linId || ''}
                                    onChange={(e) => updatePairFile(pair.id, 'lin', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-black dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                                  >
                                    <option value="">— Select ULP  —</option>
                                    {linFilesList.map((f) => (
                                      <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div 
                                  className="px-2 py-2 border-r border-slate-300 dark:border-slate-600 min-w-[100px] flex items-center"
                                >
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={pair.try === '' || pair.try === null || pair.try === undefined ? '' : pair.try}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      const val = e.target.value;
                                      // อนุญาตให้เป็น empty string หรือตัวเลขเท่านั้น
                                      if (val === '' || /^\d+$/.test(val)) {
                                        updatePairTry(pair.id, val);
                                      }
                                    }}
                                    onBlur={(e) => {
                                      e.stopPropagation();
                                      // เมื่อ blur ถ้าเป็น empty string ให้ตั้งเป็น 1
                                      if (e.target.value === '' || e.target.value === null || e.target.value === undefined) {
                                        updatePairTry(pair.id, '1');
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      // อนุญาตให้พิมพ์ตัวเลข, backspace, delete, arrow keys, tab
                                      if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter'].includes(e.key)) {
                                        e.preventDefault();
                                      }
                                    }}
                                    placeholder="1"
                                    className="w-full min-w-0 px-1.5 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-black dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-center"
                                    title="Number of test runs (editable, default: 1)"
                                  />
                                </div>
                                <div className="px-2 py-2 border-r border-slate-300 dark:border-slate-600">
                                  <select
                                    value={pair.boardId || ''}
                                    onChange={(e) => updatePairBoard(pair.id, e.target.value || null)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-1.5 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-black dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                                    title="Select board for this test case (Any = use batch default)"
                                  >
                                    <option value="">Any</option>
                                    {boards.map((b) => (
                                      <option key={b.id} value={b.id}>{b.name || b.id}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="px-3 py-2 flex items-center justify-center gap-1">
                                  <span
                                    draggable
                                    onDragStart={(e) => {
                                      e.stopPropagation();
                                      handleRowDragStart(e, idx);
                                    }}
                                    onDragEnd={(e) => {
                                      e.stopPropagation();
                                      handleRowDragEnd();
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="p-1.5 rounded cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical size={16} />
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      duplicatePair(pair.id);
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                    title="Duplicate"
                                  >
                                    <Copy size={16} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      removePair(pair.id);
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                    title="Remove"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {selectedPairs.length === 0 && (
                            <div className="p-8 text-center text-slate-400 border border-slate-300 border-t-0">
                              <p className="text-sm mb-2">No test cases yet</p>
                              <p className="text-xs">Use "Pair All" or "Add pair" to create test cases</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="p-4 text-sm text-slate-400">Select files above to create test cases</div>
                      )}
                    </div>

                    {/* Config Editor Section - รวมอยู่ใน Pair Files card */}
                    {selectedIds.length > 0 && (
                      <div className="p-4 border-t border-slate-200 bg-slate-50">
                        <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                          <Box size={16} className="text-orange-500" />
                          Config Editor
                        </h4>
                        <div className="space-y-4">
                          {/* Config Name */}
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-400 uppercase">Config Name</label>
                            <input 
                              type="text" 
                              value={configName}
                              onChange={(e) => setConfigName(e.target.value)}
                              className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                              placeholder="Enter config name"
                            />
                          </div>
                          
                          {/* Tag */}
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2">
                              <Tag size={12} />
                              Tag / Group
                            </label>
                            <div className="relative">
                              <input 
                                type="text" 
                                value={tag}
                                onChange={(e) => {
                                  setTag(e.target.value);
                                  setShowTagSuggestions(e.target.value.length > 0 && existingTags.length > 0);
                                }}
                                onFocus={() => {
                                  if (existingTags.length > 0) setShowTagSuggestions(true);
                                }}
                                onBlur={() => {
                                  setTimeout(() => setShowTagSuggestions(false), 200);
                                }}
                                className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                                placeholder="e.g., Team A, Project X, etc."
                              />
                              
                              {/* Tag Suggestions */}
                              {showTagSuggestions && existingTags.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                  {existingTags
                                    .filter(t => t.toLowerCase().includes(tag.toLowerCase()))
                                    .map((suggestedTag, idx) => (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => {
                                          setTag(suggestedTag);
                                          setShowTagSuggestions(false);
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs flex items-center gap-2"
                                      >
                                        <Tag size={10} className="text-purple-500" />
                                        <span>{suggestedTag}</span>
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                            {existingTags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {existingTags.slice(0, 5).map((existingTag, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setTag(existingTag)}
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                                      tag === existingTag
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                    }`}
                                  >
                                    {existingTag}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Preview */}
                          {selectedPairs.length > 0 && (
                            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <p className="text-xs font-bold text-blue-700 uppercase mb-2">Preview</p>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-slate-600">Test Cases:</span>
                                  <span className="font-bold text-slate-800">{selectedPairs.length}</span>
                                </div>
                                {tag && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-slate-600">Tag:</span>
                                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold">
                                      {tag}
                                    </span>
                                  </div>
                                )}
                                {configName && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-600">Config:</span>
                                    <span className="font-bold text-slate-800">{configName}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-slate-600">Board Selection:</span>
                                  <span className="font-bold text-slate-800">
                                    {boardSelectionMode === 'auto' ? 'Auto-Assign' : `${selectedBoardIds.length} board(s)`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Board Selection */}
                          <div className="space-y-4">
                            <span className="text-sm font-bold text-black dark:text-white uppercase tracking-wide block">Board Selection</span>
                            <div className="flex flex-wrap gap-4">
                              <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all flex-1 min-w-[200px] ${
                                boardSelectionMode === 'auto'
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500'
                              }`}>
                                <input
                                  type="radio"
                                  name="boardSelectionMode"
                                  checked={boardSelectionMode === 'auto'}
                                  onChange={() => { setBoardSelectionMode('auto'); setRunBoardSelection({ mode: 'auto', boardIds: [] }); }}
                                  className="mt-0.5 w-4 h-4 text-blue-600 border-slate-300"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-black dark:text-white">Auto-Assign (Any Available)</span>
                                    {boardSelectionMode === 'auto' && <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />}
                                  </div>
                                  <p className="text-sm text-slate-700 dark:text-slate-200 mt-1">Run on first available board matching criteria.</p>
                                </div>
                              </label>
                              <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all flex-1 min-w-[200px] ${
                                boardSelectionMode === 'manual'
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500'
                              }`}>
                                <input
                                  type="radio"
                                  name="boardSelectionMode"
                                  checked={boardSelectionMode === 'manual'}
                                  onChange={() => { setBoardSelectionMode('manual'); setRunBoardSelection({ mode: 'manual', boardIds: selectedBoardIds }); }}
                                  className="mt-0.5 w-4 h-4 text-blue-600 border-slate-300"
                                />
                                <div className="flex-1 min-w-0">
                                  <span className="font-bold text-black dark:text-white">Manual Selection</span>
                                </div>
                              </label>
                            </div>
                            {boardSelectionMode === 'manual' && (
                              <div className="space-y-1">
                                <p className="text-xs text-slate-600 dark:text-slate-400">You can select busy boards; jobs will queue until the board is free.</p>
                                <div className="max-h-40 overflow-y-auto border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-800 p-2">
                                {loading?.boards ? (
                                  <div className="text-sm text-slate-700 dark:text-slate-200 py-2">Loading boards...</div>
                                ) : errors?.boards ? (
                                  <div className="text-sm text-red-600 dark:text-red-400 py-2">Failed to load boards</div>
                                ) : boards.length === 0 ? (
                                  <div className="text-sm text-slate-700 dark:text-slate-200 py-2">No boards</div>
                                ) : (
                                  <div className="space-y-0.5">
                                    {boards.map(b => {
                                      const isIdle = b.status === 'online' && !b.currentJob;
                                      const isBusy = b.status === 'busy' || (b.status === 'online' && !!b.currentJob);
                                      const isOffline = b.status === 'offline' || b.status === 'error';
                                      const canSelect = b.status === 'online';
                                      return (
                                        <label
                                          key={b.id}
                                          className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                                            selectedBoardIds.includes(b.id)
                                              ? 'bg-blue-100 dark:bg-blue-900/50'
                                              : canSelect
                                              ? 'hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer'
                                              : 'opacity-60 cursor-not-allowed'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selectedBoardIds.includes(b.id)}
                                            onChange={() => canSelect && toggleSelectedBoard(b.id)}
                                            disabled={!canSelect}
                                            className="w-4 h-4 rounded border-slate-400 text-blue-600 disabled:opacity-50"
                                          />
                                          <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-black dark:text-white truncate">{b.name}</div>
                                            <div className="text-xs text-slate-600 dark:text-slate-300">{b.ip || 'No IP'}</div>
                                          </div>
                                          <span className="flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0">
                                            {isIdle && <><span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden /> (Idle)</>}
                                            {isBusy && <><Clock size={12} className="text-amber-500" /> (Busy)</>}
                                            {isOffline && <><XCircle size={12} className="text-red-500" /> (Offline)</>}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                                </div>
                              </div>
                            )}
                            {setupErrors.boards && (
                              <div className="text-xs text-red-600">{setupErrors.boards}</div>
                            )}

                            {/* Priority */}
                            <div className="pt-4 mt-2 border-t border-slate-300 dark:border-slate-600">
                              <span className="text-sm font-bold text-black dark:text-white uppercase tracking-wide block mb-2">Priority</span>
                              <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer border border-slate-200 dark:border-slate-600">
                                <input
                                  type="checkbox"
                                  checked={testNowHighPriority}
                                  onChange={(e) => setTestNowHighPriority(e.target.checked)}
                                  className="w-4 h-4 rounded border-slate-400 text-amber-500"
                                />
                                <Zap size={18} className="text-amber-500 shrink-0" />
                                <span className="text-sm font-semibold text-black dark:text-white">Test Now! (High Priority)</span>
                              </label>
                            </div>
                          </div>

                          {/* Create Batch Button */}
                          <button 
                            disabled={isCreatingBatch || selectedPairs.length === 0}
                            className={`w-full bg-slate-900 text-white py-3 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
                              isCreatingBatch || selectedPairs.length === 0
                                ? 'opacity-60 cursor-not-allowed'
                                : 'hover:bg-black'
                            }`}
                            onClick={async () => {
                              if (isCreatingBatch) return;
                              
                              // ใช้ pairs ที่ถูกเลือกจาก checkbox (selectedTestCaseIds)
                              // ถ้าไม่มีเลือกเลย ให้ใช้ทั้งหมด
                              const pairsToUse = selectedTestCaseIds.length > 0
                                ? selectedPairs.filter(pair => selectedTestCaseIds.includes(pair.id))
                                : selectedPairs;
                              
                              if (pairsToUse.length === 0) {
                                addToast({ type: 'warning', message: 'Please select at least one test case pair' });
                                return;
                              }
                              if (boardSelectionMode === 'manual' && selectedBoardIds.length === 0) {
                                setSetupErrors((prev) => ({ ...prev, boards: 'Select at least one board.' }));
                                return;
                              }

                              const boardNames = boardSelectionMode === 'auto'
                                ? []
                                : boards.filter(b => selectedBoardIds.includes(b.id)).map(b => b.name);

                              // สร้าง files array จาก pairs ที่เลือก (แต่ละ pair = 1 test case)
                              // ส่งข้อมูลไฟล์ทั้งหมด: VCD, ERoM (BIN), ULP (LIN)
                              const filesFromPairs = pairsToUse.map((pair, index) => {
                                const vcdFile = uploadedFiles.find(f => f.id === pair.vcdId);
                                const binFile = uploadedFiles.find(f => f.id === pair.binId);
                                const linFile = pair.linId ? uploadedFiles.find(f => f.id === pair.linId) : null;
                                const boardName = pair.boardId ? boards.find(b => b.id === pair.boardId)?.name : undefined;
                                return {
                                  name: vcdFile?.name || '', // VCD file name (primary)
                                  order: index + 1,
                                  try: pair.try || 1,
                                  vcd: vcdFile?.name || '', // VCD file
                                  erom: binFile?.name || '', // ERoM (BIN) file
                                  ulp: linFile?.name || null, // ULP (LIN) file (optional)
                                  board: boardName, // บอร์ดที่รัน test case นี้ (ถ้า backend รองรับ)
                                };
                              });

                              // ใช้ firmware จาก pair แรก
                              const firstPair = pairsToUse[0];
                              const firmwareFile = uploadedFiles.find(f => f.id === firstPair.binId);

                              // เก็บ pairs data สำหรับ edit batch (เก็บ file IDs, file names และ try count)
                              const pairsDataForHistory = pairsToUse.map(pair => {
                                const vcdFile = uploadedFiles.find(f => f.id === pair.vcdId);
                                const binFile = uploadedFiles.find(f => f.id === pair.binId);
                                const linFile = pair.linId ? uploadedFiles.find(f => f.id === pair.linId) : null;
                                
                                return {
                                  vcdId: pair.vcdId,
                                  binId: pair.binId,
                                  linId: pair.linId || null,
                                  vcdName: vcdFile?.name || '', // เก็บ file name สำหรับ fallback
                                  binName: binFile?.name || '', // เก็บ file name สำหรับ fallback
                                  linName: linFile?.name || null, // เก็บ file name สำหรับ fallback
                                  try: pair.try || 1,
                                  boardId: pair.boardId || null,
                                  boardName: pair.boardId ? boards.find(b => b.id === pair.boardId)?.name : null,
                                };
                              });

                              const jobPayload = {
                                name: configName || `Batch ${new Date().toISOString()}`,
                                tag: tag || undefined,
                                firmware: firmwareFile?.name || '',
                                boards: boardNames,
                                priority: testNowHighPriority ? 'high' : undefined,
                                files: filesFromPairs.map(f => ({
                                  name: f.name, // VCD file name (for backward compatibility)
                                  order: f.order,
                                  vcd: f.vcd, // VCD file
                                  erom: f.erom, // ERoM (BIN) file
                                  ulp: f.ulp, // ULP (LIN) file
                                  try_count: f.try, // Number of test rounds
                                  ...(f.board != null && { board: f.board }), // บอร์ดที่รัน test case นี้ (backend รองรับเมื่อไหร่จะใช้ได้)
                                })),
                                configName: configName || undefined,
                                pairsData: pairsDataForHistory, // เก็บ pairs data สำหรับ edit
                              };

                              try {
                                setIsCreatingBatch(true);
                                const result = editJobId
                                  ? await updateJob(editJobId, jobPayload)
                                  : await createJob(jobPayload);
                                if (result) {
                                  if (editJobId && onEditComplete) {
                                    onEditComplete();
                                  }
                                  setSelectedIds([]);
                                  setSelectedPairs([]);
                                  setSelectedBoardIds([]);
                                  setSelectedTestCaseIds([]);
                                  setTag('');
                                  setConfigName('Default_Setup');
                                  addToast({
                                    type: 'success',
                                    message: editJobId ? 'Batch updated successfully.' : 'Batch created successfully.',
                                  });
                                } else {
                                  addToast({
                                    type: 'error',
                                    message: editJobId ? 'Failed to update batch.' : 'Failed to create batch.',
                                  });
                                }
                              } finally {
                                setIsCreatingBatch(false);
                              }
                            }}
                          >
                            {isCreatingBatch ? (
                              <>
                                <RefreshCw size={16} className="animate-spin" />
                                {editJobId ? 'Updating...' : 'Creating...'}
                              </>
                            ) : (
                              <>
                                <Play size={16} />
                                {editJobId ? 'Update Batch' : 'Create Batch'}
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
              </>
            ) : (
              <>
                {/* Test Commands Section */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Command size={20} className="text-blue-600" />
                        <h3 className="text-lg font-bold">My Test Commands</h3>
          </div>
                      <button
                        onClick={() => {
                          setEditingCommand(null);
                          setCommandForm({ name: '', command: '', description: '', category: 'testing' });
                          setShowCommandManager(true);
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
                      >
                        <Command size={16} />
                        Manage Commands
                      </button>
                    </div>
                    <p className="text-sm text-slate-600 mb-6">
                      Select a test command that you've written. The system will help run it on selected boards.
                      <br />
                      <span className="text-xs text-slate-500 mt-1 block">
                        Use placeholders: <code className="bg-slate-100 px-1 rounded">{'{board_id}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{firmware}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{boards}'}</code>
                      </span>
                    </p>
                    
                    {!testCommands || testCommands.length === 0 ? (
                      <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                        <Command size={48} className="text-slate-400 mx-auto mb-4" />
                        <p className="text-slate-600 font-bold mb-2">No test commands yet</p>
                        <p className="text-sm text-slate-500 mb-4">Create your first test command to get started</p>
                        <button
                          onClick={() => {
                            setEditingCommand(null);
                            setCommandForm({ name: '', command: '', description: '', category: 'testing' });
                            setShowCommandManager(true);
                          }}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-all inline-flex items-center gap-2"
                        >
                          <Command size={16} />
                          Add Your First Command
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {testCommands.map((cmd) => (
                          <div
                            key={cmd.id}
                            onClick={() => setSelectedTestCommand(cmd)}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                              selectedTestCommand?.id === cmd.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-slate-200 hover:border-blue-300 bg-slate-50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="font-bold text-slate-800">{cmd.name}</div>
                                  <span className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-xs font-bold">
                                    {cmd.category}
                                  </span>
                                </div>
                                {cmd.description && (
                                  <div className="text-sm text-slate-600 mb-2">{cmd.description}</div>
                                )}
                                <div className="font-mono text-xs text-slate-700 bg-white p-3 rounded border border-slate-200">
                                  {getResolvedCommand(cmd)}
                                </div>
                              </div>
                              {selectedTestCommand?.id === cmd.id && (
                                <CheckCircle2 size={20} className="text-blue-600 shrink-0" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {setupErrors.command && (
                      <div className="mt-4 text-sm text-red-600">
                        {setupErrors.command}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Test Commands Manager Modal */}
        {showCommandManager && (
          <TestCommandsManagerModal
            commands={testCommands}
            editingCommand={editingCommand}
            commandForm={commandForm}
            setCommandForm={setCommandForm}
            onClose={() => {
              setShowCommandManager(false);
              setEditingCommand(null);
              setCommandForm({ name: '', command: '', description: '', category: 'testing' });
            }}
            onSave={(cmd) => {
              if (editingCommand) {
                updateTestCommand(editingCommand.id, cmd);
              } else {
                addTestCommand(cmd);
              }
              setShowCommandManager(false);
              setEditingCommand(null);
              setCommandForm({ name: '', command: '', description: '', category: 'testing' });
            }}
            onEdit={(cmd) => {
              if (cmd) {
                setEditingCommand(cmd);
                setCommandForm({
                  name: cmd.name,
                  command: cmd.command,
                  description: cmd.description || '',
                  category: cmd.category || 'testing'
                });
              } else {
                setEditingCommand(null);
                setCommandForm({ name: '', command: '', description: '', category: 'testing' });
              }
            }}
            onDelete={(id) => {
              if (window.confirm('Are you sure you want to delete this command?')) {
                deleteTestCommand(id);
                if (selectedTestCommand?.id === id) {
                  setSelectedTestCommand(null);
                }
              }
            }}
            onDuplicate={(id) => {
              duplicateTestCommand(id);
            }}
          />
        )}
      </div>
    );
  };

export default SetupPage;
