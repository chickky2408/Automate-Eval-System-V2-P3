/**
 * Mock API Service
 * 
 * This is a development-only service that simulates API responses.
 * Backend developers can use this as a reference for expected data structures.
 * 
 * In production, replace imports from this file with the actual API service.
 */

// Simulate network delay
const delay = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms));

// Mock data
const mockBoards = [
  { id: 1, name: 'Board #1', status: 'online', ip: '192.168.1.101', mac: '00:1B:44:11:3A:B7', firmware: 'v2.3.1', model: 'STM32', voltage: 3.3, signal: -45, temp: 42, currentJob: 'Batch #2024-001' },
  { id: 2, name: 'Board #2', status: 'online', ip: '192.168.1.102', mac: '00:1B:44:11:3A:B8', firmware: 'v2.3.1', model: 'STM32', voltage: 3.2, signal: -50, temp: 40, currentJob: null },
];

const mockJobs = [
  {
    id: '2024-001',
    name: 'ERQM Regression Test',
    progress: 75,
    status: 'running',
    tag: 'Team A',
    totalFiles: 20,
    completedFiles: 15,
    firmware: 'ERQM_v2.3.bin',
    boards: ['Board #1', 'Board #3'],
    startedAt: '2026-01-13 10:30',
    files: [
      { id: 1, name: 'test_case_001.vcd', status: 'completed', result: 'pass', order: 1 },
      { id: 2, name: 'test_case_002.vcd', status: 'running', result: null, order: 2 },
    ]
  }
];

export const mockApi = {
  getSystemHealth: async () => {
    await delay();
    return {
      totalBoards: 52,
      onlineBoards: 45,
      busyBoards: 5,
      errorBoards: 2,
      storageUsage: 68,
      storageTotal: '10TB',
      storageUsed: '6.8TB',
      boardApiStatus: 'online'
    };
  },
  
  getBoards: async (filters = {}) => {
    await delay();
    let filtered = [...mockBoards];
    if (filters.status) {
      filtered = filtered.filter(b => b.status === filters.status);
    }
    return filtered;
  },
  
  getJobs: async (filters = {}) => {
    await delay();
    let filtered = [...mockJobs];
    if (filters.tag) {
      filtered = filtered.filter(j => j.tag === filters.tag);
    }
    return filtered;
  },
  
  createJob: async (jobData) => {
    await delay(1000);
    return {
      id: `2024-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
      ...jobData,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString()
    };
  },
  
  uploadFile: async (file, metadata = {}) => {
    await delay(800);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.name.endsWith('.vcd') ? 'vcd' : 'firmware',
      uploadDate: new Date().toISOString()
    };
  },
};

export default mockApi;
