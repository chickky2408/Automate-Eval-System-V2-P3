import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Menu, X, LayoutDashboard, Settings, PlayCircle, Cpu, 
  History, Search, FileCode, User, UserPlus, LogOut, Pencil, FileDown, FileUp, Trash2,
  CheckCircle2, AlertCircle, Database, Copy, FolderOpen, Eye,
  Wifi, WifiOff,
  Activity, XCircle,
  Monitor,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { useTestStore } from './store/useTestStore';
import API_ENDPOINTS from './utils/apiEndpoints';
import { getClientId } from './utils/sessionStorage';
import { rememberClientOwnerLabel, resolveJobOwnerDisplayName } from './utils/profileOwnerLabel';
import DashboardPage from './pages/DashboardPage';
import WaveformPage from './pages/WaveformPage';
import TestCasesPage from './pages/TestCasesPage';
import FileLibraryPage from './pages/FileLibraryPage';
import RunSetPage from './pages/RunSetPage';
import SetupPage from './pages/SetupPage';
import JobsPage from './pages/JobsPage';
import BoardsPage from './pages/BoardsPage';
import HistoryPage from './pages/HistoryPage';
import NotificationBell from './components/NotificationBell';
import { jobTagPillClasses } from './utils/tagPalette';
import JobTagManagerModal from './components/JobTagManagerModal';

// --- MAIN APPLICATION COMPONENT ---
const App = () => {
  const [activePage, setActivePage] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [expandJobId, setExpandJobId] = useState(null); // for expanding job from history / deep-link
  const [tagManagerJobId, setTagManagerJobId] = useState(null);
  const { systemHealth, boards, theme, toggleTheme } = useTestStore();
  const profiles = useTestStore((s) => s.profiles) || [];
  const activeProfileId = useTestStore((s) => s.activeProfileId);
  const refreshSystemHealth = useTestStore((state) => state.refreshSystemHealth);
  const refreshBoards = useTestStore((state) => state.refreshBoards);
  const refreshJobs = useTestStore((state) => state.refreshJobs);
  const refreshNotifications = useTestStore((state) => state.refreshNotifications);
  const refreshFiles = useTestStore((state) => state.refreshFiles);
  const refreshGlobalTestCaseData = useTestStore((state) => state.refreshGlobalTestCaseData);
  const silentRefreshSystemHealth = useTestStore((state) => state.silentRefreshSystemHealth);
  const silentRefreshBoards = useTestStore((state) => state.silentRefreshBoards);
  const silentRefreshJobs = useTestStore((state) => state.silentRefreshJobs);
  const silentRefreshNotifications = useTestStore((state) => state.silentRefreshNotifications);
  const silentRefreshFiles = useTestStore((state) => state.silentRefreshFiles);
  const addSharedProfile = useTestStore((state) => state.addSharedProfile);
  const setViewingSharedProfile = useTestStore((state) => state.setViewingSharedProfile);
  const fetchSharedProfileData = useTestStore((state) => state.fetchSharedProfileData);
  const availableBoards = boards.filter(b => b.status === 'online' && !b.currentJob).length;
  const queuedBoardsLeft = availableBoards;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  useEffect(() => {
    const p = profiles.find((x) => x.id === activeProfileId);
    if (p?.name) rememberClientOwnerLabel(getClientId(), p.name);
  }, [profiles, activeProfileId]);

  // Open shared profile when URL hash is #/shared/<profile_id>
  useEffect(() => {
    const applyHash = () => {
      try {
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        const m = hash.match(/^#?\/?shared\/([^/?#]+)/);
        if (!m || !m[1]) return;
        const profileId = (m[1] || '').trim();
        if (!profileId) return;
        addSharedProfile(profileId);
        setViewingSharedProfile(profileId);
        fetchSharedProfileData(profileId);
        setActivePage('testCases');
      } catch (err) {
        console.warn('[App] hash shared profile apply failed', err);
      }
    };
    applyHash();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', applyHash);
      return () => window.removeEventListener('hashchange', applyHash);
    }
  }, [addSharedProfile, setViewingSharedProfile, fetchSharedProfileData]);

  useEffect(() => {
    // First run: use normal refresh (with loading state for user)
    const initialFetch = async () => {
      await Promise.allSettled([
        refreshSystemHealth(),
        refreshBoards(),
        refreshJobs(),
        refreshNotifications(),
        refreshFiles(),
        refreshGlobalTestCaseData(),
      ]);
    };

    // Subsequent runs: use silent refresh without touching loading to avoid UI flicker
    const silentFetchAll = async () => {
      await Promise.allSettled([
        silentRefreshSystemHealth(),
        silentRefreshBoards(),
        silentRefreshJobs(),
        silentRefreshNotifications(),
        silentRefreshFiles(),
        refreshGlobalTestCaseData(),
      ]);
    };

    void initialFetch();

    const intervalId = setInterval(silentFetchAll, 5000); // poll every 5 seconds
    return () => clearInterval(intervalId);
  }, [
    refreshSystemHealth,
    refreshBoards,
    refreshJobs,
    refreshNotifications,
    refreshFiles,
    refreshGlobalTestCaseData,
    silentRefreshSystemHealth,
    silentRefreshBoards,
    silentRefreshJobs,
    silentRefreshNotifications,
    silentRefreshFiles,
  ]);

  return (
    <div
      className={`flex min-h-screen font-sans overflow-hidden transition-colors duration-300 ${
        theme === 'dark' ? 'bg-slate-950 text-slate-50' : 'bg-slate-50 text-slate-900'
      }`}
    >
      
      {/* 1. SIDEBAR (Collapsible; on mobile: overlay when open, narrow strip when closed) */}
      <aside className={`fixed left-0 top-0 h-screen bg-slate-900 text-slate-300 z-50 transition-all duration-300 ease-in-out ${
        isSidebarOpen ? 'w-64' : 'w-14 sm:w-16 md:w-20'
      }`}>
        <div className="flex items-center justify-between px-6 h-20 border-b border-slate-800">
          {isSidebarOpen && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-xl font-bold text-white tracking-tight">BOARD TEST</h2>
              <p className="text-[10px] text-blue-500 font-bold tracking-widest uppercase">Enterprise v2.0</p>
            </div>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors mx-auto">
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        
        <nav className="mt-6 px-3 space-y-2">
          <NavItem icon={<LayoutDashboard size={20}/>} label="Dashboard" active={activePage === 'dashboard'} isOpen={isSidebarOpen} onClick={() => setActivePage('dashboard')} />
          <NavItem icon={<Database size={20}/>} label="Library" active={activePage === 'fileLibrary'} isOpen={isSidebarOpen} onClick={() => setActivePage('fileLibrary')} />
          <NavItem icon={<FileCode size={20}/>} label="Create Test Case" active={activePage === 'testCases'} isOpen={isSidebarOpen} onClick={() => setActivePage('testCases')} />
          <NavItem icon={<PlayCircle size={20}/>} label="Run Set" active={activePage === 'runSet'} isOpen={isSidebarOpen} onClick={() => setActivePage('runSet')} />
          <NavItem icon={<Monitor size={20}/>} label="Jobs Manager" active={activePage === 'jobs'} isOpen={isSidebarOpen} onClick={() => setActivePage('jobs')} />
          <NavItem icon={<Cpu size={20}/>} label="Board Status" active={activePage === 'boards'} isOpen={isSidebarOpen} onClick={() => setActivePage('boards')} />
          <NavItem icon={<History size={20}/>} label="Test History" active={activePage === 'history'} isOpen={isSidebarOpen} onClick={() => setActivePage('history')} />
          <NavItem icon={<Activity size={20}/>} label="Realtime Waveform" active={activePage === 'waveform'} isOpen={isSidebarOpen} onClick={() => setActivePage('waveform')} />
        </nav>
      </aside>

      {/* 2. MAIN CONTENT AREA (narrow margin when sidebar closed; overlay when open on small screens) */}
      <main
        className={`flex-1 flex flex-col min-h-screen min-w-0 transition-all duration-300 ${
          isSidebarOpen ? 'ml-0 md:ml-64' : 'ml-14 sm:ml-16 md:ml-20'
        }`}
      >
        
        {/* TOP HEADER BAR (simple, no summary row) */}
        <header
          className={`sticky top-0 z-40 border-b transition-colors ${
            theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="h-14 flex items-center justify-between px-4 sm:px-6 lg:px-8 gap-2 min-w-0">
            {activePage === 'dashboard' ? (
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">System Dashboard</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Monitoring {systemHealth.totalBoards} boards
                </span>
                {(() => {
                  const total = systemHealth.totalBoards || 0;
                  const online = systemHealth.onlineBoards || 0;
                  const busy = systemHealth.busyBoards || 0;
                  const stale = systemHealth.staleBoards || 0;
                  const error = systemHealth.errorBoards || 0;
                  const ready = online + busy;
                  // Degraded only when nothing is available to run work — not when a few boards are down in a mixed fleet.
                  let healthStatus = 'unknown';
                  if (total === 0) healthStatus = 'unknown';
                  else if (ready === 0) healthStatus = 'error';
                  else if (stale > 0 || error > 0) healthStatus = 'warning';
                  else healthStatus = 'ok';
                  const healthConfig = {
                    ok: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', label: 'System OK' },
                    warning: { bg: 'bg-amber-50 dark:bg-emerald-900/30', text: 'text-amber-600 dark:text-amber-400', label: 'Some boards need attention' },
                    error: { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', label: 'System degraded' },
                    unknown: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'No boards' },
                  };
                  const c = healthConfig[healthStatus] || healthConfig.unknown;
                  return (
                    <div
                      className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${c.bg} ${c.text} border-current/20`}
                      title={
                        healthStatus === 'warning'
                          ? `${error} offline/error, ${stale} stale (no heartbeat >60s while online/busy)`
                          : healthStatus === 'error'
                            ? 'No boards online or busy — fleet unavailable'
                            : ''
                      }
                    >
                      {healthStatus === 'ok' && <CheckCircle2 size={13} />}
                      {healthStatus === 'warning' && <AlertCircle size={13} />}
                      {healthStatus === 'error' && <XCircle size={13} />}
                      <span>{c.label}</span>
                    </div>
                  );
                })()}
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  systemHealth.boardApiStatus === 'online' 
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-900/30 dark:border-emerald-800' 
                    : 'bg-red-50 text-red-600 border border-red-100 dark:bg-red-900/30 dark:border-red-800'
                }`}>
                  {systemHealth.boardApiStatus === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />}
                  <span>REST API {systemHealth.boardApiStatus === 'online' ? 'Online' : 'Offline'}</span>
                </div>
              </div>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-3">
              <ProfileSwitcher />
              <button
                type="button"
                onClick={toggleTheme}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-full border text-xs font-semibold transition-colors ${
                  theme === 'dark'
                    ? 'bg-slate-800 border-slate-700 text-amber-300 hover:bg-slate-700'
                    : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                }`}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? '☀' : '🌙'}
              </button>
              <NotificationBell
                onOpenJob={(jobId) => {
                  if (jobId == null) return;
                  setExpandJobId(jobId);
                  setActivePage('jobs');
                }}
              />
            </div>
          </div>
        </header>

        {/* CONTENT PAGES */}
        <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden overflow-y-auto min-w-0">
          {/* Keep these 3 pages mounted so local "in-progress" UI state doesn't reset */}
          <div className={activePage === 'fileLibrary' ? '' : 'hidden'}>
            <FileLibraryPage
              onNavigateToTestCases={() => setActivePage('testCases')}
              onNavigateToRunSet={() => setActivePage('runSet')}
            />
          </div>
          <div className={activePage === 'testCases' ? '' : 'hidden'}>
            <TestCasesPage
              onNavigateBackToLibrary={() => {
                useTestStore.getState().setFileLibraryViewOnNavigate('rawTestCases');
                setActivePage('fileLibrary');
              }}
              onNavigateToRunSet={() => setActivePage('runSet')}
            />
          </div>
          <div className={activePage === 'runSet' ? '' : 'hidden'}>
            <RunSetPage onNavigateJobs={() => setActivePage('jobs')} />
          </div>

          {/* Other pages can unmount normally */}
          {activePage === 'dashboard' && (
            <DashboardPage
              onNavigateBoards={() => setActivePage('boards')}
              onNavigateJobs={(jobId) => {
                if (jobId != null) setExpandJobId(jobId);
                setActivePage('jobs');
              }}
              onManageTags={(jobId) => setTagManagerJobId(jobId)}
            />
          )}
          {activePage === 'setup' && (
            <SetupPage editJobId={expandJobId} onEditComplete={() => setExpandJobId(null)} />
          )}
          {activePage === 'jobs' && (
            <JobsPage
              expandJobId={expandJobId}
              onManageTags={(jobId) => setTagManagerJobId(jobId)}
              onExpandComplete={() => setExpandJobId(null)}
              onEditJob={(jobId) => {
                setExpandJobId(jobId);
                setActivePage('setup');
              }}
              onNavigateToFileLibrary={(fileName) => {
                useTestStore.getState().setLibraryFocusFileNameOnNavigate(fileName);
                setActivePage('fileLibrary');
              }}
              onNavigateToTestCases={(focus) => {
                useTestStore.getState().setTestCaseLibraryFocusOnNavigate(focus);
                setActivePage('testCases');
              }}
            />
          )}
          {activePage === 'boards' && <BoardsPage />}
          {activePage === 'history' && (
            <HistoryPage
              onViewJob={(jobId) => {
                setExpandJobId(jobId);
                setActivePage('jobs');
              }}
            />
          )}
          {activePage === 'waveform' && <WaveformPage />}
        </div>
      </main>
      <ToastContainer />
      <JobAttentionBanner
        onOpenJob={(jobId) => {
          if (jobId == null) return;
          setExpandJobId(jobId);
          setActivePage('jobs');
        }}
      />
      <JobTagManagerModal jobId={tagManagerJobId} onClose={() => setTagManagerJobId(null)} />
    </div>
  );
};

// --- COMPONENTS ---

const NavItem = ({ icon, label, active, isOpen, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 p-2.5 sm:p-3 rounded-xl text-sm font-medium transition-all min-w-0 ${
    active ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'hover:bg-slate-800 text-slate-400'
  }`}>
    <div className={`flex-shrink-0 ${!isOpen ? 'mx-auto' : ''}`}>{icon}</div>
    {isOpen && <span className="animate-in fade-in slide-in-from-left-2 duration-300 truncate">{label}</span>}
  </button>
);

const ProfileSwitcher = () => {
  const theme = useTestStore((state) => state.theme);
  const profiles = useTestStore((state) => (Array.isArray(state.profiles) ? state.profiles : []));
  const activeProfileId = useTestStore((state) => state.activeProfileId);
  const sharedProfiles = useTestStore((state) => (Array.isArray(state.sharedProfiles) ? state.sharedProfiles : []));
  const isBackendProfileId = useTestStore((state) => state.isBackendProfileId);
  const createProfile = useTestStore((state) => state.createProfile);
  const switchProfile = useTestStore((state) => state.switchProfile);
  const deleteProfile = useTestStore((state) => state.deleteProfile);
  const updateProfileName = useTestStore((state) => state.updateProfileName);
  const exportProfile = useTestStore((state) => state.exportProfile);
  const importProfile = useTestStore((state) => state.importProfile);
  const addSharedProfile = useTestStore((state) => state.addSharedProfile);
  const removeSharedProfile = useTestStore((state) => state.removeSharedProfile);
  const setViewingSharedProfile = useTestStore((state) => state.setViewingSharedProfile);
  const fetchSharedProfileData = useTestStore((state) => state.fetchSharedProfileData);
  const addToast = useTestStore((state) => state.addToast);

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [sharedIdInput, setSharedIdInput] = useState('');
  const [isAddingShared, setIsAddingShared] = useState(false);
  const [isCreateLoading, setIsCreateLoading] = useState(false);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || { id: 'default', name: 'Default' };
  const canShare = isBackendProfileId && isBackendProfileId(activeProfileId);
  const shareLink = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}#/shared/${activeProfileId}` : '';

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setIsCreating(false);
        setEditingId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) {
      addToast({ type: 'warning', message: 'Please enter a profile name' });
      return;
    }
    setIsCreateLoading(true);
    try {
      await createProfile(newProfileName.trim());
      addToast({ type: 'success', message: `Created profile "${newProfileName.trim()}"` });
      setNewProfileName('');
      setIsCreating(false);
      setIsOpen(false);
    } catch (e) {
      addToast({ type: 'error', message: e?.message || 'Failed to create profile' });
    } finally {
      setIsCreateLoading(false);
    }
  };

  const handleSwitchProfile = (profileId) => {
    switchProfile(profileId);
    addToast({ type: 'success', message: `Switched to profile "${profiles.find((p) => p.id === profileId)?.name || 'Unknown'}"` });
    setIsOpen(false);
  };

  const handleShareProfile = async () => {
    try {
      await navigator.clipboard.writeText(activeProfileId);
      addToast({ type: 'success', message: 'Profile ID copied to clipboard' });
    } catch {
      addToast({ type: 'info', message: `Profile ID: ${activeProfileId}` });
    }
    setIsOpen(false);
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      addToast({ type: 'success', message: 'Share link copied to clipboard' });
    } catch {
      addToast({ type: 'info', message: shareLink });
    }
    setIsOpen(false);
  };

  const handleAddSharedProfile = async () => {
    let id = sharedIdInput.trim();
    const match = id.match(/#\/shared\/([^/?#]+)/);
    if (match) id = match[1];
    if (!id) {
      addToast({ type: 'warning', message: 'Enter a profile ID or share link' });
      return;
    }
    setIsAddingShared(true);
    try {
      const result = await addSharedProfile(id);
      if (result.ok) {
        addToast({ type: 'success', message: 'Shared profile added' });
        setSharedIdInput('');
        setIsAddingShared(false);
      } else {
        addToast({ type: 'error', message: result.error || 'Failed to add' });
      }
    } catch (e) {
      addToast({ type: 'error', message: e?.message || 'Failed to add shared profile' });
    } finally {
      setIsAddingShared(false);
    }
  };

  const handleViewSharedProfile = async (profileId) => {
    setViewingSharedProfile(profileId);
    await fetchSharedProfileData(profileId);
    setIsOpen(false);
    addToast({ type: 'info', message: 'Viewing shared profile (read-only). Use "Copy to my profile" to copy.' });
  };

  const handleDeleteProfile = (profileId, profileName) => {
    if (profileId === 'default') {
      addToast({ type: 'error', message: 'Cannot delete the Default profile' });
      return;
    }
    if (window.confirm(`Delete profile "${profileName}"?`)) {
      deleteProfile(profileId);
      addToast({ type: 'success', message: `Deleted profile "${profileName}"` });
      setIsOpen(false);
    }
  };

  const handleStartEdit = (profileId, currentName) => {
    setEditingId(profileId);
    setEditingName(currentName);
  };

  const handleSaveEdit = (profileId) => {
    if (!editingName.trim()) {
      addToast({ type: 'warning', message: 'Please enter a profile name' });
      return;
    }
    updateProfileName(profileId, editingName.trim());
    addToast({ type: 'success', message: `Renamed profile to "${editingName.trim()}"` });
    setEditingId(null);
    setEditingName('');
  };

  const handleExportProfile = async (profileId, includeHistory = false) => {
    try {
      const exported = await exportProfile(profileId || activeProfileId, includeHistory);
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `profile_${exported.name || 'export'}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast({ type: 'success', message: `Exported profile "${exported.name}"` });
      setIsOpen(false);
    } catch (error) {
      addToast({ type: 'error', message: `Export failed: ${error.message}` });
    }
  };

  const handleImportProfile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      const profileName = imported.name || 'Imported Profile';
      const newId = importProfile(imported, { name: profileName, switchToImported: true });
      addToast({ type: 'success', message: `Imported profile "${profileName}"` });
      setIsOpen(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      addToast({ type: 'error', message: `Import failed: ${error.message}` });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
          theme === 'dark'
            ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
        }`}
        title="Profile Settings"
      >
        <User size={16} />
        <span className="max-w-[120px] truncate">{activeProfile.name}</span>
        <ChevronDown size={14} className={isOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {isOpen && (
        <div
          className={`absolute right-0 top-full mt-2 w-72 rounded-lg border shadow-lg z-50 ${
            theme === 'dark'
              ? 'bg-slate-800 border-slate-700'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className={`p-3 border-b ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">PROFILES</div>
            {profiles.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400 py-2">No profiles</div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`flex items-center gap-2 p-2 rounded ${
                      profile.id === activeProfileId
                        ? theme === 'dark'
                          ? 'bg-blue-900/30 border border-blue-700'
                          : 'bg-blue-50 border border-blue-200'
                        : theme === 'dark'
                        ? 'hover:bg-slate-700'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    {editingId === profile.id ? (
                      <>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(profile.id);
                            if (e.key === 'Escape') {
                              setEditingId(null);
                              setEditingName('');
                            }
                          }}
                          className={`flex-1 px-2 py-1 text-sm rounded border ${
                            theme === 'dark'
                              ? 'bg-slate-700 border-slate-600 text-slate-200'
                              : 'bg-white border-slate-300 text-slate-900'
                          }`}
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveEdit(profile.id)}
                          className="p-1 text-emerald-600 hover:text-emerald-700"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditingName('');
                          }}
                          className="p-1 text-slate-500 hover:text-slate-600"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          {profile.id === activeProfileId && (
                            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                          )}
                          <span className="text-sm font-medium truncate">{profile.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {profile.id !== activeProfileId && (
                            <button
                              onClick={() => handleSwitchProfile(profile.id)}
                              className="p-1.5 rounded hover:bg-slate-600 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400"
                              title="Switch to this profile"
                            >
                              <LogOut size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => handleStartEdit(profile.id, profile.name)}
                            className="p-1.5 rounded hover:bg-slate-600 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400"
                            title="Rename"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleExportProfile(profile.id, false)}
                            className="p-1.5 rounded hover:bg-slate-600 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400"
                            title="Export"
                          >
                            <FileDown size={14} />
                          </button>
                          {profile.id !== 'default' && (
                            <button
                              onClick={() => handleDeleteProfile(profile.id, profile.name)}
                              className="p-1.5 rounded hover:bg-red-600 dark:hover:bg-red-700 text-red-600 dark:text-red-400"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canShare && (
            <div className={`p-3 border-b ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">SHARE</div>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={handleShareProfile}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                    theme === 'dark' ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                  title="Copy profile ID"
                >
                  <Copy size={16} />
                  <span>Copy profile ID</span>
                </button>
                <button
                  onClick={handleCopyShareLink}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                    theme === 'dark' ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                  title="Copy share link"
                >
                  <FolderOpen size={16} />
                  <span>Copy share link</span>
                </button>
              </div>
            </div>
          )}
          <div className={`p-3 border-b ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">SHARED WITH ME</div>
            {sharedProfiles.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto mb-2">
                {sharedProfiles.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 p-2 rounded ${theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`}
                  >
                    <span className="flex-1 text-sm truncate">{p.name || p.id}</span>
                    <button
                      onClick={() => handleViewSharedProfile(p.id)}
                      className="p-1.5 rounded text-blue-600 dark:text-blue-400 hover:bg-slate-600 dark:hover:bg-slate-600"
                      title="View (read-only)"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={() => { removeSharedProfile(p.id); addToast({ type: 'success', message: 'Removed from list' }); }}
                      className="p-1.5 rounded text-slate-500 hover:text-red-600"
                      title="Remove from list"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {isAddingShared ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sharedIdInput}
                  onChange={(e) => setSharedIdInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddSharedProfile(); if (e.key === 'Escape') { setIsAddingShared(false); setSharedIdInput(''); } }}
                  placeholder="Paste profile ID or link"
                  className={`flex-1 px-2 py-1.5 text-sm rounded border ${theme === 'dark' ? 'bg-slate-700 border-slate-600 text-slate-200' : 'bg-white border-slate-300 text-slate-900'}`}
                  autoFocus
                />
                <button onClick={handleAddSharedProfile} className="p-1.5 text-emerald-600 hover:text-emerald-700" disabled={!sharedIdInput.trim()}>
                  <CheckCircle2 size={16} />
                </button>
                <button onClick={() => { setIsAddingShared(false); setSharedIdInput(''); }} className="p-1.5 text-slate-500 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingShared(true)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${theme === 'dark' ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-50 text-slate-700'}`}
              >
                <UserPlus size={16} />
                <span>Add shared profile</span>
              </button>
            )}
          </div>
          <div className={`p-3 border-b ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
            {isCreating ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProfile();
                    if (e.key === 'Escape') {
                      setIsCreating(false);
                      setNewProfileName('');
                    }
                  }}
                  placeholder="Profile name"
                  className={`flex-1 px-2 py-1.5 text-sm rounded border ${
                    theme === 'dark'
                      ? 'bg-slate-700 border-slate-600 text-slate-200'
                      : 'bg-white border-slate-300 text-slate-900'
                  }`}
                  autoFocus
                />
                <button
                  onClick={handleCreateProfile}
                  disabled={isCreateLoading}
                  className="p-1.5 text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 size={16} />
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewProfileName('');
                  }}
                  className="p-1.5 text-slate-500 hover:text-slate-600"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                  theme === 'dark'
                    ? 'hover:bg-slate-700 text-slate-300'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <UserPlus size={16} />
                <span>Create new profile</span>
              </button>
            )}
          </div>

          <div className="p-3 space-y-2">
            <button
              onClick={() => handleExportProfile(activeProfileId, true)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                theme === 'dark'
                  ? 'hover:bg-slate-700 text-slate-300'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <FileDown size={16} />
              <span>Export profile (with history)</span>
            </button>
            <label
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors cursor-pointer ${
                theme === 'dark'
                  ? 'hover:bg-slate-700 text-slate-300'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <FileUp size={16} />
              <span>Import profile</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportProfile}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

const JobAttentionBanner = ({ onOpenJob }) => {
  const banner = useTestStore((s) => s.jobAttentionBanner);
  const dismiss = useTestStore((s) => s.dismissJobAttentionBanner);
  const requestPerm = useTestStore((s) => s.requestBrowserNotificationPermission);
  const theme = useTestStore((s) => s.theme);
  const [permBusy, setPermBusy] = useState(false);

  if (!banner) return null;

  const isDark = theme === 'dark';
  const panel = isDark
    ? 'bg-slate-900 border-slate-600 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';
  const sub = isDark ? 'text-slate-400' : 'text-slate-600';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4 pointer-events-auto"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="job-attention-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Dismiss"
        onClick={() => dismiss()}
      />
      <div className={`relative max-w-md w-full rounded-2xl border shadow-2xl p-5 ${panel}`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className={`w-8 h-8 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
            ) : banner.type === 'error' ? (
              <AlertCircle className={`w-8 h-8 ${isDark ? 'text-red-400' : 'text-red-600'}`} />
            ) : (
              <Activity className={`w-8 h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="job-attention-title" className="text-lg font-bold leading-tight">
              {banner.title}
            </h2>
            <p className={`text-sm mt-2 ${sub}`}>{banner.message}</p>
            {typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default' && (
              <button
                type="button"
                disabled={permBusy}
                className={`mt-3 text-xs font-semibold underline ${isDark ? 'text-blue-300' : 'text-blue-600'}`}
                onClick={async () => {
                  setPermBusy(true);
                  try {
                    await requestPerm();
                  } finally {
                    setPermBusy(false);
                  }
                }}
              >
                Enable browser notifications
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss()}
            className={`p-1 rounded-lg ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {banner.jobId != null && (
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dismiss()}
              className={`px-3 py-2 text-sm font-semibold rounded-xl ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-800'}`}
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => {
                const id = banner.jobId;
                dismiss();
                onOpenJob?.(id);
              }}
              className="px-3 py-2 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700"
            >
              Open job
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const ToastContainer = () => {
  const { toasts, removeToast } = useTestStore();

  if (!toasts || toasts.length === 0) return null;

  const getToastStyles = (type) => {
    switch (type) {
      case 'success':
        return 'bg-emerald-50 border-emerald-200 text-emerald-800';
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warning':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      default:
        return 'bg-slate-50 border-slate-200 text-slate-800';
    }
  };

  return (
    <div className="fixed top-6 right-6 z-[70] space-y-3 max-w-sm w-full">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 border rounded-xl px-4 py-3 shadow-lg ${getToastStyles(toast.type)}`}
        >
          <div className="pt-0.5">
            {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          </div>
          <div className="flex-1 text-sm font-medium">{toast.message}</div>
          <button
            onClick={() => removeToast(toast.id)}
            className="p-1 rounded hover:bg-black/5"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};

// 1. DASHBOARD PAGE (Enhanced)
const DashboardPageInline = ({ onNavigateBoards, onNavigateJobs }) => {
  const {
    systemHealth,
    boards,
    jobs,
    commonCommands,
    updateJobTag,
    loading,
    errors,
  } = useTestStore();
  const boardQueuePaused = useTestStore((state) => state.boardQueuePaused || {});
  const profiles = useTestStore((s) => s.profiles) || [];
  const sharedProfiles = useTestStore((s) => s.sharedProfiles) || [];
  const serverProfileDirectory = useTestStore((s) => s.serverProfileDirectory) || [];
  const activeProfileId = useTestStore((s) => s.activeProfileId);
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || { id: 'default', name: 'Default' };
  const jobOwnerLabelCtx = useMemo(
    () => ({
      profiles,
      sharedProfiles,
      serverProfileDirectory,
      activeProfileId,
      activeProfileName: activeProfile.name,
      currentClientId: getClientId(),
    }),
    [profiles, sharedProfiles, serverProfileDirectory, activeProfileId, activeProfile.name]
  );

  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showBatchDetails, setShowBatchDetails] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(null);
  const [isSystemSummaryExpanded, setIsSystemSummaryExpanded] = useState(false);
  const [systemSearch, setSystemSearch] = useState('');
  const [systemStatusFilter, setSystemStatusFilter] = useState('running'); // 'all' | 'pending' | 'running' | 'completed' | 'stopped'
  const [systemTagFilter, setSystemTagFilter] = useState('');
  const [systemOwnerFilter, setSystemOwnerFilter] = useState('all'); // 'all' | 'mine' | 'others'
  const [editingSystemTagId, setEditingSystemTagId] = useState(null);
  const [systemTagEditInput, setSystemTagEditInput] = useState('');
  const [systemModalJobId, setSystemModalJobId] = useState(null);
  const [systemModalBoardId, setSystemModalBoardId] = useState(null);

  // ใช้ข้อมูลเดียวกับ Fleet Manager (รวม mock boards) เพื่อให้ Dashboard แสดงสถานะตรงกัน
  const dashboardDemoBoards = useMemo(
    () => [
      // ONLINE
      {
        id: 'BOARD-1',
        name: 'Demo Board 1',
        status: 'online',
        ip: '192.168.0.10',
        mac: '00:11:22:33:44:55',
        firmware: 'v1.0.0',
        model: 'Zybo',
        tag: 'paused',
        fpgaStatus: 'unknown',
        armStatus: 'online',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: true,
        isDemo: true,
      },
      {
        id: 'BOARD-2',
        name: 'Line A – Ready',
        status: 'online',
        ip: '192.168.0.11',
        mac: '00:11:22:33:44:66',
        firmware: 'v1.0.3',
        model: 'Zybo',
        tag: 'line-a',
        fpgaStatus: 'active',
        armStatus: 'online',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      // BUSY
      {
        id: 'BOARD-3',
        name: 'Burn-in Tester 1',
        status: 'busy',
        ip: '192.168.0.21',
        mac: '00:11:22:33:44:88',
        firmware: 'v1.1.0',
        model: 'Zybo',
        tag: 'burn-in',
        fpgaStatus: 'active',
        armStatus: 'busy',
        currentJob: '10Mar ',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-4',
        name: 'Demo Board – Busy',
        status: 'busy',
        ip: '192.168.0.22',
        mac: '00:11:22:33:44:99',
        firmware: 'v1.0.5',
        model: 'Zybo',
        tag: 'running',
        fpgaStatus: 'active',
        armStatus: 'busy',
        currentJob: 'test-1',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      // ERROR / OFFLINE
      {
        id: 'BOARD-ERR',
        name: 'Demo Error Board',
        status: 'error',
        ip: '192.168.0.31',
        mac: '00:11:22:33:44:77',
        firmware: 'v1.0.0',
        model: 'Zybo',
        tag: 'error',
        fpgaStatus: 'error',
        armStatus: 'offline',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-OFF',
        name: 'Spare Board (offline)',
        status: 'error',
        ip: '192.168.0.32',
        mac: '00:11:22:33:44:AA',
        firmware: 'v0.9.0',
        model: 'Zybo',
        tag: 'maintenance',
        fpgaStatus: 'offline',
        armStatus: 'offline',
        currentJob: '—',
        voltage: '0.0',
        queuePaused: false,
        isDemo: true,
      },
    ],
    []
  );

  const fleetBoards = useMemo(() => {
    const realBoards = boards || [];
    const byId = new Map();
    realBoards.forEach((b) => {
      byId.set(String(b.id), b);
    });
    dashboardDemoBoards.forEach((demo) => {
      const id = String(demo.id);
      const base = byId.get(id) || {};
      byId.set(id, { ...base, ...demo });
    });
    const merged = Array.from(byId.values());
    return merged.map((b) => {
      const override = boardQueuePaused[String(b.id)];
      return override === undefined ? b : { ...b, queuePaused: override };
    });
  }, [boards, dashboardDemoBoards, boardQueuePaused]);

  const fleetTotalBoards = fleetBoards.length;
  const fleetOnlineBoards = fleetBoards.filter((b) => b.status === 'online').length;
  const fleetBusyBoards = fleetBoards.filter((b) => b.status === 'busy').length;
  
  const pendingJobs = jobs.filter(j => j.status === 'pending');
  const jobQueueCount = pendingJobs.length;
  const jobErrorCount = jobs.filter((job) => {
    if (job.status !== 'completed' && job.status !== 'stopped') return false;
    return (job.files || []).some((f) => {
      const result = (f.result || '').toLowerCase();
      const status = (f.status || '').toLowerCase();
      return result === 'fail' || status === 'error';
    });
  }).length;

  const clientId = getClientId();
  const systemSearchLower = systemSearch.trim().toLowerCase();
  const systemTagOptions = [...new Set(jobs.map((j) => j.tag).filter(Boolean))].sort();

  const systemSummaryJobs = jobs.filter((job) => {
    if (systemStatusFilter !== 'all' && job.status !== systemStatusFilter) return false;
    if (systemTagFilter && (job.tag || '').toLowerCase() !== systemTagFilter.toLowerCase()) return false;
    if (systemOwnerFilter === 'mine' && job.clientId !== clientId) return false;
    if (systemOwnerFilter === 'others' && (job.clientId === clientId || !job.clientId)) return false;
    if (systemSearchLower) {
      const name = (job.name || '').toLowerCase();
      const id = (job.id || '').toLowerCase();
      const tag = (job.tag || '').toLowerCase();
      if (
        !name.includes(systemSearchLower) &&
        !id.includes(systemSearchLower) &&
        !tag.includes(systemSearchLower)
      ) {
        return false;
      }
    }
    return true;
  });

  // System Summary: สรุปว่า system ไหน run อะไรอยู่ (ตาม filter)
  const systemSummary = systemSummaryJobs.map(job => {
    const rawAt = job.startedAt || job.createdAt;
    const d = rawAt ? new Date(rawAt) : null;
    const displayDate = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const displayTime = d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    const ownerLabel = resolveJobOwnerDisplayName(job, jobOwnerLabelCtx);
    return {
      jobId: job.id,
      jobName: job.name,
      tag: job.tag || 'Untagged',
      tagColor: job.tagColor,
      boards: job.boards || [],
      status: job.status,
      totalFiles: job.totalFiles ?? (job.files ? job.files.length : 0),
      firmware: job.firmware,
      ownerLabel,
      displayDate,
      displayTime
    };
  });
  
  const availableBoards = fleetBoards.filter(b => b.status === 'online' && !b.currentJob).length;
  const queuedBoardsLeft = availableBoards; // simplified
  const deviceProgressRows = fleetBoards.map((b) => {
    const boardKey = (b.name || b.id || '').toString();
    let jobId = (b.currentJob || '').replace(/^(Batch|Set) #/, '');
    let job = jobs.find((j) => j.id === jobId);
    // Fallback: if board.currentJob ไม่ถูกเซ็ต ให้หา job ที่ assign board นี้อยู่ (running ก่อน, ถ้าไม่มีก็ pending)
    if (!job) {
      job =
        jobs.find(
          (j) =>
            (j.status === 'running') &&
            (j.boards || []).some((jb) => (jb || '').toString() === boardKey)
        ) ||
        jobs.find(
          (j) =>
            (j.status === 'pending') &&
            (j.boards || []).some((jb) => (jb || '').toString() === boardKey)
        ) ||
        null;
    }
    // Demo UX: ถ้า board เป็นสถานะ Busy แต่ยังไม่มี job จริง ให้ใช้ currentJob ของ board เป็นชื่อ set ที่กำลัง run
    if (!job && (b.status || '').toLowerCase() === 'busy' && b.currentJob) {
      job = {
        id: `DEMO-${b.id}`,
        name: (b.currentJob || '').toString(),
        status: 'running',
        boards: [boardKey],
        clientId: clientId,
        files: [],
        progress: 0,
        completedFiles: 0,
        totalFiles: 0,
      };
    }
    const progress = job ? job.progress : 0;
    const completedFiles = job ? job.completedFiles ?? 0 : 0;
    const totalFiles = job ? job.totalFiles ?? (job.files ? job.files.length : 0) : 0;
    const remainingFiles = Math.max(0, totalFiles - completedFiles);
    const jobsWaitingForBoard = pendingJobs.filter(
      (j) =>
        !(j.boards || []).length ||
        (j.boards || []).some((jb) => (jb || '').toString() === boardKey)
    ).length;
    return { board: b, progress, job, completedFiles, totalFiles, remainingFiles, jobsWaitingForBoard };
  });
  
  const handleCopyCommand = (command) => {
    navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    setTimeout(() => setCopiedCommand(null), 2000);
  };
  
  const hasDashboardError = errors?.systemHealth || errors?.boards || errors?.jobs;
  const isDashboardLoading = loading?.systemHealth || loading?.boards || loading?.jobs;

  const goToBoardStatus = () => {
    if (onNavigateBoards) {
      onNavigateBoards();
    }
  };

  const goToJobManager = () => {
    if (onNavigateJobs) {
      onNavigateJobs();
    }
  };

  const systemModalJob = systemModalJobId
    ? jobs.find((j) => j.id === systemModalJobId)
    : null;

  const systemModalBoardRow = systemModalBoardId
    ? deviceProgressRows.find((r) => (r.board?.id || r.board?.name) === systemModalBoardId)
    : null;

  const getDashboardTestCaseDisplayName = (file) =>
    file?.testCaseName || (file?.order != null ? `Test case ${file.order}` : '—');

  const systemModalFiles = systemModalJob?.files
    ? [...systemModalJob.files].sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];
  const systemModalRunningFiles = systemModalFiles.filter((f) => (f.status || '').toLowerCase() === 'running');
  const systemModalFailedFiles = systemModalFiles.filter((f) => {
    const result = (f.result || '').toLowerCase();
    const status = (f.status || '').toLowerCase();
    return result === 'fail' || status === 'error' || status === 'failed';
  });
  let systemModalSummaryText = '';
  if (systemModalJob) {
    const status = (systemModalJob.status || '').toLowerCase();
    if (status === 'pending') {
      systemModalSummaryText = 'Pending — waiting to start';
    } else if (status === 'running') {
      if (systemModalRunningFiles.length > 0) {
        const names = systemModalRunningFiles
          .slice(0, 2)
          .map((f) => getDashboardTestCaseDisplayName(f))
          .join(', ');
        systemModalSummaryText =
          systemModalRunningFiles.length > 1
            ? `Running test cases: ${names}${systemModalRunningFiles.length > 2 ? ` +${systemModalRunningFiles.length - 2} more` : ''}`
            : `Running test case: ${names}`;
      } else {
        systemModalSummaryText = 'Running — waiting for next test case';
      }
    } else if (status === 'completed' || status === 'stopped') {
      if (systemModalFailedFiles.length > 0) {
        systemModalSummaryText = `Completed with ${systemModalFailedFiles.length} failed test case(s)`;
      } else {
        systemModalSummaryText = 'Set completed';
      }
    }
  }

  return (
    <div className="space-y-2.5 min-w-0">
      {(hasDashboardError || isDashboardLoading) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          hasDashboardError
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          {hasDashboardError
            ? `Failed to load dashboard data: ${hasDashboardError}`
            : 'Loading dashboard data...'}
        </div>
      )}

      {/* System Health Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard 
          icon={<CheckCircle2 className="text-emerald-500" />} 
          label="Online" 
          value={fleetOnlineBoards} 
          sub={`${fleetTotalBoards} Total Boards`} 
          onClick={goToBoardStatus}
        />
        <StatCard 
          icon={<Zap className="text-blue-500"/>} 
          label="Busy" 
          value={fleetBusyBoards} 
          sub="Running Board" 
          onClick={goToBoardStatus}
        />
        <StatCard 
          icon={<AlertCircle className="text-red-500" />} 
          label="Job Errors" 
          value={jobErrorCount} 
          sub="Set with failed tests" 
          onClick={goToJobManager}
        />
        <StatCard 
          icon={<Activity className="text-purple-500" />} 
          label="Job Queue" 
          value={jobQueueCount} 
          sub="Set waiting to run" 
          onClick={goToJobManager}
        />
      <StatCard 
          icon={<HardDrive className="text-orange-500"/>} 
          label="Storage" 
          value={`${systemHealth.storageUsage}%`} 
          sub={`${systemHealth.storageUsed} / ${systemHealth.storageTotal}`} 
        />
    </div>

      {/* System Summary - System ไหน run อะไรอยู่ */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers size={20} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">System Summary</h2>
            {systemSummary.length > 0 && (
              <span className="text-sm text-slate-500 dark:text-slate-400 font-normal">
                ({systemSummary.length} {systemSummary.length === 1 ? 'system' : 'systems'})
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={systemSearch}
                onChange={(e) => setSystemSearch(e.target.value)}
                placeholder="Search by ID, name, tag..."
                className="pl-7 pr-2 py-1.5 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800 rounded-full px-1 py-0.5">
              <select
                value={systemOwnerFilter}
                onChange={(e) => setSystemOwnerFilter(e.target.value)}
                className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Owner"
              >
                <option value="all">All owners</option>
                <option value="mine">Me</option>
                <option value="others">Other clients</option>
              </select>
              <select
                value={systemStatusFilter}
                onChange={(e) => setSystemStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Batch status"
              >
                <option value="running">Running</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="stopped">Stopped</option>
                <option value="all">All Status</option>
              </select>
              <select
                value={systemTagFilter}
                onChange={(e) => setSystemTagFilter(e.target.value)}
                className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Tag"
              >
                <option value="">All Tags</option>
                {systemTagOptions.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
            {systemSummary.length > 3 && (
              <button
                onClick={() => setIsSystemSummaryExpanded(!isSystemSummaryExpanded)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
              >
                {isSystemSummaryExpanded ? (
                  <>
                    <ChevronUp size={14} />
                    <span>Collapse</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} />
                    <span>Expand</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        {systemSummary.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(isSystemSummaryExpanded ? systemSummary : systemSummary.slice(0, 3)).map((sys) => {
                const status = (sys.status || '').toLowerCase();
                const statusColors =
                  status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : status === 'pending'
                    ? 'border-amber-200 bg-amber-50/40'
                    : status === 'stopped'
                    ? 'border-red-200 bg-red-50/40'
                    : 'border-blue-200 bg-blue-50/40';
                const dotColor =
                  status === 'completed'
                    ? 'bg-emerald-500'
                    : status === 'pending'
                    ? 'bg-amber-500'
                    : status === 'stopped'
                    ? 'bg-red-500'
                    : 'bg-blue-500';
                const isEditingTag = editingSystemTagId === sys.jobId;
                const handleTagClick = (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const job = jobs.find((j) => j.id === sys.jobId);
                  setEditingSystemTagId(sys.jobId);
                  setSystemTagEditInput(job?.tag || '');
                };
                const handleTagSave = (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const newTag = systemTagEditInput.trim();
                  updateJobTag(sys.jobId, newTag || null);
                  setEditingSystemTagId(null);
                  setSystemTagEditInput('');
                };
                const handleTagCancel = (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setEditingSystemTagId(null);
                  setSystemTagEditInput('');
                };
                return (
                <div
                  key={sys.jobId}
                  className={`p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer dark:bg-slate-800 dark:border-slate-700 ${statusColors}`}
                  onClick={() => setSystemModalJobId(sys.jobId)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                          {sys.jobName || `Set #${sys.jobId}`}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">ID: {sys.jobId}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isEditingTag ? (
                        <>
                          <input
                            type="text"
                            value={systemTagEditInput}
                            onChange={(e) => setSystemTagEditInput(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="px-2 py-0.5 text-[11px] border border-purple-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-400"
                            placeholder="Tag"
                          />
                          <button
                            onClick={handleTagSave}
                            className="p-1 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white"
                            title="Save tag"
                          >
                            <CheckSquare size={12} />
                          </button>
                          <button
                            onClick={handleTagCancel}
                            className="p-1 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700"
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleTagClick}
                          className={`px-2 py-0.5 rounded text-xs font-bold border hover:brightness-95 transition-colors ${jobTagPillClasses(sys.tagColor)}`}
                          title="Edit tag"
                        >
                          {sys.tag}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className={`inline-flex w-2 h-2 rounded-full ${dotColor}`} />
                    <span className="uppercase tracking-wide font-semibold">
                      {status || 'RUNNING'}
                    </span>
                  </div>
                  {(sys.displayDate || sys.displayTime) && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      {sys.displayDate}{sys.displayTime ? ` · ${sys.displayTime}` : ''}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    <div className="mb-0.5">
                      Owner: {sys.ownerLabel || '—'} ({sys.clientID})
                    </div>
                    <div>
                      Boards:{' '}
                      {sys.boards.length > 0 ? sys.boards.join(', ') : '—'}
                    </div>
                  </div>
                </div>
              )})}
            </div>
            {!isSystemSummaryExpanded && systemSummary.length > 3 && (
              <div className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
                Showing top 3 of {systemSummary.length} systems. Click "Expand" to view all.
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500">
            <p>No active systems running</p>
          </div>
        )}
      </div>

      {/* System Summary - Quick View Modal */}
      {systemModalJob && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSystemModalJobId(null)}
        >
          <div
            className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-stretch justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Layers size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                      {systemModalJob.name || systemModalJob.configName || `Set #${systemModalJob.id}`}
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    ID: {systemModalJob.id}
                  </p>
                </div>
              </div>
              <div className="hidden shrink-0 items-stretch sm:flex">
                {(systemModalJob.tag || systemModalJob.tagColor) && (
                  <div className="flex items-center pr-3">
                    <span
                      className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-bold border ${jobTagPillClasses(systemModalJob.tagColor)}`}
                    >
                      {systemModalJob.tag || 'Untagged'}
                    </span>
                  </div>
                )}
                <div className="flex items-center border-l border-slate-200 pl-4 dark:border-slate-600">
                  <button
                    onClick={() => {
                      setSystemModalJobId(null);
                      setExpandJobId(systemModalJob?.id ?? null);
                      setActivePage('jobs');
                    }}
                    type="button"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Monitor size={14} />
                    Open in Job Manager
                  </button>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <span>Test Cases</span>
                    <span className="text-[10px] font-normal text-slate-500">
                      (running / failed highlighted)
                    </span>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto text-xs">
                      {(!systemModalJob.files || systemModalJob.files.length === 0) ? (
                    <div className="px-4 py-6 text-center text-slate-400">
                      No test cases in this set.
                    </div>
                  ) : (
                    (systemModalJob.files || [])
                      .slice()
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                      .map((file) => {
                        const isRunning = file.status === 'running';
                        const isFailed =
                          (file.result || '').toLowerCase() === 'fail' ||
                          (file.status || '').toLowerCase() === 'error' ||
                          (file.status || '').toLowerCase() === 'failed';
                        const rowBg = isFailed
                          ? 'bg-red-50'
                          : isRunning
                          ? 'bg-blue-50'
                          : 'bg-white';
                        return (
                          <div
                            key={file.id}
                            className={`px-4 py-2 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 ${rowBg}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-slate-400 shrink-0">
                                #{file.order || file.id}
                              </span>
                              <span className="truncate font-medium text-slate-700">
                                {getDashboardTestCaseDisplayName(file)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] uppercase font-semibold text-slate-500">
                                {file.status || 'pending'}
                              </span>
                              {file.result && (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    file.result === 'pass'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : file.result === 'fail'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {file.result.toUpperCase()}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setSystemModalJobId(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 rounded-lg hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Board popup: คลิกที่ Device Progress card → แสดง board กำลัง run set ไหน ของใคร + ปุ่มไป Board Status */}
      {systemModalBoardRow && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSystemModalBoardId(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <div className="flex items-center gap-2">
                <Cpu size={18} className="text-blue-600 dark:text-blue-400" />
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                  {systemModalBoardRow.board?.name || 'Board'}
                </h2>
              </div>
              <button
                onClick={() => setSystemModalBoardId(null)}
                className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {systemModalBoardRow.job ? (
                <>
                  <div className="text-sm">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-0.5">Running set</div>
                    {(() => {
                      const rawName = (systemModalBoardRow.job.name || systemModalBoardRow.job.configName || '').trim();
                      const displayName = rawName.replace(/^Batch\\s*#/i, 'Set ');
                      return (
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {displayName || `Set #${systemModalBoardRow.job.id}`}
                        </div>
                      );
                    })()}
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">ID: {systemModalBoardRow.job.id}</div>
                  </div>
                  <div className="text-sm">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-0.5">Owner</div>
                    <div className="font-medium text-slate-700 dark:text-slate-300">
                      {resolveJobOwnerDisplayName(systemModalBoardRow.job, jobOwnerLabelCtx)}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-0.5">Status</div>
                  <div className="font-medium text-slate-700 dark:text-slate-300">Idle</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Queue: {systemModalBoardRow.jobsWaitingForBoard} waiting
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => setSystemModalBoardId(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setSystemModalBoardId(null);
                  goToBoardStatus();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <Activity size={14} />
                Board Status
              </button>
              {systemModalBoardRow.job && (
                <button
                  onClick={() => {
                    setSystemModalBoardId(null);
                    setExpandJobId(systemModalBoardRow.job?.id ?? null);
                    setActivePage('jobs');
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-600 text-white hover:bg-slate-700"
                >
                  <Monitor size={14} />
                  Job Manager
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="w-full">
        {/* Device Progress - compact cards */}
        <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">Device Progress</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {deviceProgressRows.length === 0 ? (
              <div className="col-span-full py-4 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                No devices available
              </div>
            ) : (
              deviceProgressRows.map(({ board, progress, job, completedFiles, totalFiles, remainingFiles, jobsWaitingForBoard }) => {
                const status = (board.status || '').toLowerCase();
                const isBusy = status === 'busy';
                const isOnline = status === 'online';
                return (
                  <div
                    key={board.id}
                    className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500 cursor-pointer"
                    onClick={() => setSystemModalBoardId(board.id)}
                    title="Click to view board details"
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{board.name}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                        isBusy
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : isOnline
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300'
                      }`}>
                        {isBusy ? 'Busy' : isOnline ? 'Online' : (board.status || '—')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mb-1" title={job ? `${((job.configName || job.name || 'Set').trim()).replace(/^Batch\\s*#/i, 'Set ')} · set #${job.id}` : 'Idle'}>
                      {job ? `${((job.configName || job.name || 'Set').trim()).replace(/^Batch\\s*#/i, 'Set ')} · #${job.id}` : 'Idle'}
                    </div>
                    {isBusy && (
                      <>
                        <div className="h-1 w-full bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden mb-1">
                          <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          {completedFiles}/{totalFiles} ({progress}%) · {remainingFiles} left · Queue: {jobsWaitingForBoard}
                        </div>
                      </>
                    )}
                    {!isBusy && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Queue: {jobsWaitingForBoard} waiting</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Batch Details Modal */}
      {showBatchDetails && selectedBatch && (
        <BatchDetailsModal 
          batch={selectedBatch}
          onClose={() => {
            setShowBatchDetails(false);
            setSelectedBatch(null);
          }}
        />
      )}
    </div>
);
};

// 1.5. REALTIME WAVEFORM PAGE (Node จำลอง Sine 125kHz @ fs=1MHz → Backend → UXUI)
const MAX_WAVEFORM_SAMPLES = 3000;   // เก็บใน buffer
const DISPLAY_WAVEFORM_SAMPLES = 800; // แสดงแค่ช่วงล่าสุด เพื่อไม่ให้เส้นทับกันจนเป็นสีทึบ
const WAVEFORM_CANVAS_WIDTH = 800;
const WAVEFORM_CANVAS_HEIGHT = 320;

const WaveformPageInline = () => {
  const boards = useTestStore((state) => state.boards || []);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const bufferRef = useRef({ CH1: [], CH2: [], CH3: [], CH4: [] });
  const rafRef = useRef(null);
  const wsRef = useRef(null);
  const connectedRef = useRef(false);
  const fsRef = useRef(4000);
  const showWaveformRef = useRef(true);
  const showPlayheadRef = useRef(true);
  const showGridRef = useRef(true);
  const visibleSignalsRef = useRef({ ch1: true, ch2: true, ch3: true, ch4: true });
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState({ freq_hz: 125000, fs: 4000 });
  const [lastChunkAt, setLastChunkAt] = useState(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [runProgress, setRunProgress] = useState(0);
  const [showWaveform, setShowWaveform] = useState(true);
  const [showPlayhead, setShowPlayhead] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomLevelRef = useRef(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [scaleMode, setScaleMode] = useState('manual');
  const [yMinManual, setYMinManual] = useState(-1);
  const [yMaxManual, setYMaxManual] = useState(1);
  const scaleModeRef = useRef(scaleMode);
  const yMinManualRef = useRef(yMinManual);
  const yMaxManualRef = useRef(yMaxManual);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [scrollOffset, setScrollOffset] = useState(0); // samples offset from the end (only meaningful when paused)
  const scrollOffsetRef = useRef(0);
  const [viewPanelOpen, setViewPanelOpen] = useState(false);
  const viewButtonRef = useRef(null);
  const viewPopoverRef = useRef(null);
  const [viewPopoverPos, setViewPopoverPos] = useState({ top: 0, left: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ active: false, startX: 0, startOffset: 0 });
  const [visibleSignals, setVisibleSignals] = useState({ ch1: true, ch2: true, ch3: true, ch4: true });
  const [showCursor, setShowCursor] = useState(true);
  const [cursorFrac, setCursorFrac] = useState(0.35);
  const [cursor2Frac, setCursor2Frac] = useState(0.65);
  const [showCursor2, setShowCursor2] = useState(true);
  const [cursorChannel, setCursorChannel] = useState('ch1');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const showCursorRef = useRef(true);
  const cursorFracRef = useRef(0.35);
  const cursor2FracRef = useRef(0.65);
  const showCursor2Ref = useRef(true);
  const cursorChannelRef = useRef('ch1');
  const isDraggingCursorRef = useRef(false);
  const activeCursorRef = useRef(1); // 1 or 2
  const plotGeometryRef = useRef(null);
  const [, setTick] = useState(0);
  const onlineBoards = boards.filter((b) => b.status === 'online');
  connectedRef.current = connected;
  fsRef.current = meta.fs || 4000;
  showWaveformRef.current = showWaveform;
  showPlayheadRef.current = showPlayhead;
  showGridRef.current = showGrid;
  zoomLevelRef.current = zoomLevel;
  scaleModeRef.current = scaleMode;
  yMinManualRef.current = yMinManual;
  yMaxManualRef.current = yMaxManual;
  pausedRef.current = paused;
  scrollOffsetRef.current = scrollOffset;
  visibleSignalsRef.current = visibleSignals;
  showCursorRef.current = showCursor;
  cursorFracRef.current = cursorFrac;
  cursor2FracRef.current = cursor2Frac;
  showCursor2Ref.current = showCursor2;
  cursorChannelRef.current = cursorChannel;

  // Auto-select first online board when available (frontend only – backend can choose how to use boardId)
  useEffect(() => {
    if (!selectedBoardId && onlineBoards.length > 0) {
      setSelectedBoardId(onlineBoards[0].id);
    }
  }, [onlineBoards, selectedBoardId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // When resuming live mode, snap view back to the latest samples.
  useEffect(() => {
    if (!paused) {
      setScrollOffset(0);
      setViewPanelOpen(false);
    }
  }, [paused]);

  // Close View popover on outside click + keep it positioned.
  useEffect(() => {
    if (!viewPanelOpen) return;

    const POPOVER_W = 224; // w-56
    const MARGIN = 8;

    const position = () => {
      const btn = viewButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = Math.max(
        MARGIN,
        Math.min(window.innerWidth - POPOVER_W - MARGIN, rect.right - POPOVER_W)
      );
      const top = rect.bottom + 8;
      setViewPopoverPos({ top, left });
    };

    const onDown = (e) => {
      const pop = viewPopoverRef.current;
      const btn = viewButtonRef.current;
      if (pop?.contains(e.target) || btn?.contains(e.target)) return;
      setViewPanelOpen(false);
    };

    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [viewPanelOpen]);

  // Clamp scroll offset whenever the window size changes (pause mode only).
  useEffect(() => {
    if (!paused) return;
    const displayCountUI = Math.max(
      2,
      Math.min(sampleCount || 0, Math.round(DISPLAY_WAVEFORM_SAMPLES / (zoomLevel || 1)))
    );
    const maxOffset = Math.max(0, (sampleCount || 0) - displayCountUI);
    setScrollOffset((o) => Math.max(0, Math.min(maxOffset, o)));
  }, [paused, zoomLevel, sampleCount]);

  useEffect(() => {
    const id = setInterval(() => {
      setRunProgress((p) => (p >= 100 ? 0 : p + 1));
    }, 20);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(id);
  }, [connected]);

  const RECONNECT_MS = 3000;

  useEffect(() => {
    const baseUrl = API_ENDPOINTS.WS_WAVEFORM || 'ws://localhost:8000/ws/waveform';
    const url = selectedBoardId
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}boardId=${encodeURIComponent(selectedBoardId)}`
      : baseUrl;
    let cancelled = false;
    let reconnectTimeoutId = null;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        bufferRef.current = { CH1: [], CH2: [], CH3: [], CH4: [] };
        setSampleCount(0);
        setLastChunkAt(null);
        if (!cancelled) {
          reconnectTimeoutId = setTimeout(connect, RECONNECT_MS);
        }
      };
      ws.onerror = () => setConnected(false);

      ws.onmessage = (event) => {
        if (pausedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'waveform') {
            const buffers = bufferRef.current;
            let ch1Count = 0;

            if (Array.isArray(msg.data?.channels)) {
              msg.data.channels.forEach((ch, idx) => {
                const id = ch?.id || `CH${idx + 1}`;
                if (!Array.isArray(ch?.samples)) return;
                if (!buffers[id]) buffers[id] = [];
                const arr = buffers[id];
                ch.samples.forEach((s) => {
                  arr.push(Number(s));
                  if (arr.length > MAX_WAVEFORM_SAMPLES) arr.shift();
                });
              });
              ch1Count = buffers.CH1 ? buffers.CH1.length : 0;
            } else if (Array.isArray(msg.data?.samples)) {
              // backward compatibility: map samples -> CH1
              if (!buffers.CH1) buffers.CH1 = [];
              const arr = buffers.CH1;
              msg.data.samples.forEach((s) => {
                arr.push(Number(s));
                if (arr.length > MAX_WAVEFORM_SAMPLES) arr.shift();
              });
              ch1Count = arr.length;
            }

            if (ch1Count > 0) {
              setLastChunkAt(Date.now());
              setSampleCount(ch1Count);
            }
            if (msg.data?.freq_hz != null) {
              setMeta((m) => ({
                ...m,
                freq_hz: msg.data.freq_hz,
                fs: msg.data.fs ?? m.fs,
              }));
            }
          }
        } catch (_) {}
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, containerWidth);
    const h = WAVEFORM_CANVAS_HEIGHT;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    let stopped = false;
    const draw = () => {
      if (stopped) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      const buffers = bufferRef.current;
      const buf = buffers.CH1 || [];
      const cw = w;
      const ch = h;

      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, cw, ch);

      const padding = { left: 40, right: 20, top: 20, bottom: 30 };
      const plotLeft = padding.left;
      const plotRight = cw - padding.right;
      const plotTop = padding.top;
      const plotBottom = ch - padding.bottom;
      const plotW = plotRight - plotLeft;
      const plotH = plotBottom - plotTop;
      const midY = plotTop + plotH / 2;

      // จำนวนจุดที่ใช้คำนวณ scale เวลา
      const bufHasData = buf.length >= 2;
      const zoom = zoomLevelRef.current;
      const displayCount = Math.max(2, Math.min(buf.length, Math.round(DISPLAY_WAVEFORM_SAMPLES / zoom)));
      const endIndex = Math.max(0, Math.min(buf.length, buf.length - (pausedRef.current ? (scrollOffsetRef.current || 0) : 0)));
      const startIndex = Math.max(0, endIndex - displayCount);
      const toDraw = bufHasData ? buf.slice(startIndex, endIndex) : null;
      const n = toDraw ? toDraw.length : displayCount;

      // Y scale: Auto (จาก min/max ของ toDraw) หรือ Manual (จาก user)
      let yMin = yMinManualRef.current;
      let yMax = yMaxManualRef.current;
      if (scaleModeRef.current === 'manual') {
        if (yMin > yMax) {
          const t = yMin;
          yMin = yMax;
          yMax = t;
        }
      }
      if (scaleModeRef.current === 'auto' && toDraw && toDraw.length >= 2) {
        let minV = toDraw[0];
        let maxV = toDraw[0];
        for (let i = 1; i < toDraw.length; i++) {
          const v = Number(toDraw[i]);
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        let range = maxV - minV;
        if (range < 1e-6) range = 1;
        const padding = Math.max(range * 0.05, 0.05);
        range += padding * 2;
        const midVal = (minV + maxV) / 2;
        yMin = midVal - range / 2;
        yMax = midVal + range / 2;
      }
      const yRange = Math.max(yMax - yMin, 1e-6);
      const scaleY = plotH / yRange;
      const midVal = (yMin + yMax) / 2;

      // --- แสดงแกน Y (Amplitude) ---
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotLeft, plotTop);
      ctx.lineTo(plotLeft, plotBottom);
      ctx.stroke();

      if (showGridRef.current) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
          const y = plotTop + (plotH * i) / 5;
          ctx.beginPath();
          ctx.moveTo(plotLeft, y);
          ctx.lineTo(plotRight, y);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.moveTo(plotLeft, midY);
      ctx.lineTo(plotRight, midY);
      ctx.strokeStyle = '#94a3b8';
      ctx.stroke();

      // Tick + label แกน Y ตาม yMin, yMax
      ctx.fillStyle = '#64748b';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const yTicks = [yMax, midVal, yMin];
      const yTickPositions = [plotTop, midY, plotBottom];
      for (let i = 0; i < 3; i++) {
        const y = yTickPositions[i];
        const v = yTicks[i];
        ctx.beginPath();
        ctx.moveTo(plotLeft - 4, y);
        ctx.lineTo(plotLeft, y);
        ctx.strokeStyle = '#94a3b8';
        ctx.stroke();
        const label = Math.abs(v) >= 10 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(2);
        ctx.fillText(label, plotLeft - 6, y);
      }
      const fs = fsRef.current || 4000;
      const totalSec = n / fs;

      // --- แกน X (Time) ---
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotLeft, plotBottom);
      ctx.lineTo(plotRight, plotBottom);
      ctx.stroke();

      // Tick + label เวลา: 0, T/2, T (ms)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const formatMs = (sec) => `${Math.round(sec * 1000)} ms`;
      const xTicks = [
        { x: plotLeft, t: 0 },
        { x: plotLeft + plotW / 2, t: totalSec / 2 },
        { x: plotRight, t: totalSec },
      ];
      xTicks.forEach(({ x, t }) => {
        ctx.beginPath();
        ctx.moveTo(x, plotBottom);
        ctx.lineTo(x, plotBottom + 4);
        ctx.strokeStyle = '#94a3b8';
        ctx.stroke();
        ctx.fillText(formatMs(t), x, plotBottom + 6);
      });

      // --- วาดเส้น waveform ต่อ channel (CH1–CH4) ---
      if (showWaveformRef.current && connectedRef.current && bufHasData && toDraw) {
        const step = plotW / (n - 1);

        const drawChannel = (arr, color, width = 2) => {
          if (!arr || arr.length < 2) return;
          const seg = arr.slice(startIndex, endIndex);
          if (seg.length < 2) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x = plotLeft + i * step;
            const v = Number(seg[i]);
            const y = midY - (v - midVal) * scaleY;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };

        // CH1–CH4 colors
        const ch1 = buffers.CH1;
        const ch2 = buffers.CH2;
        const ch3 = buffers.CH3;
        const ch4 = buffers.CH4;

        if (visibleSignalsRef.current.ch1) drawChannel(ch1, '#0369a1', 2.2); // blue
        if (visibleSignalsRef.current.ch2) drawChannel(ch2, '#ea580c', 1.6); // orange
        if (visibleSignalsRef.current.ch3) drawChannel(ch3, '#16a34a', 1.6); // green
        if (visibleSignalsRef.current.ch4) drawChannel(ch4, '#7c3aed', 1.6); // purple
      }

      if (showPlayheadRef.current) {
        const playheadX = pausedRef.current
          ? plotRight
          : plotLeft + ((Date.now() % 2000) / 2000) * plotW;
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(playheadX, plotTop);
        ctx.lineTo(playheadX, plotBottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- Cursor 1 & 2 แนวตั้ง + marker + T/V และ ΔT/ΔV ---
      if (showCursorRef.current && bufHasData && toDraw && n >= 2) {
        const fs = fsRef.current || 4000;
        const chMap = { ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4' };
        const chKey = cursorChannelRef.current;
        const arr = buffers[chMap[chKey]];
        const seg = arr && arr.length >= 2 ? arr.slice(startIndex, endIndex) : null;

        const getTVAtFrac = (f) => {
          if (!seg) return { tMs: 0, v: 0 };
          const idx = f * (n - 1);
          const i0 = Math.min(Math.floor(idx), n - 2);
          const i1 = i0 + 1;
          const t = Math.max(0, Math.min(1, idx - i0));
          const v0 = Number(seg[i0]);
          const v1 = Number(seg[i1]);
          const v = v0 * (1 - t) + v1 * t;
          const tMs = (startIndex + idx) / fs * 1000;
          return { tMs, v };
        };

        const drawOneCursor = (frac, isSecond) => {
          const cursorX = plotLeft + frac * plotW;
          const lineColor = isSecond ? 'rgba(59, 130, 246, 0.9)' : 'rgba(15, 23, 42, 0.9)';
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(cursorX, plotTop);
          ctx.lineTo(cursorX, plotBottom);
          ctx.stroke();
          ctx.setLineDash([]);

          if (seg) {
            const { tMs, v } = getTVAtFrac(frac);
            const y = midY - (v - midVal) * scaleY;
            ctx.fillStyle = isSecond ? 'rgba(59, 130, 246, 0.95)' : 'rgba(15, 23, 42, 0.95)';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5;
            const sq = 6;
            ctx.fillRect(cursorX - sq / 2, y - sq / 2, sq, sq);
            ctx.strokeRect(cursorX - sq / 2, y - sq / 2, sq, sq);
            const label = `T: ${tMs.toFixed(2)} ms   V: ${v.toFixed(2)} V`;
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = isSecond ? 'right' : 'left';
            ctx.textBaseline = 'middle';
            const tx = isSecond ? cursorX - 8 : cursorX + 8;
            const ty = Math.max(plotTop + 10, Math.min(plotBottom - 10, y));
            ctx.fillText(label, tx, ty);
          }
          return seg ? getTVAtFrac(frac) : null;
        };

        const data1 = drawOneCursor(Math.max(0, Math.min(1, cursorFracRef.current)), false);

        if (showCursor2Ref.current) {
          const data2 = drawOneCursor(Math.max(0, Math.min(1, cursor2FracRef.current)), true);
          if (data1 && data2) {
            const deltaT = data2.tMs - data1.tMs;
            const deltaV = data2.v - data1.v;
            ctx.font = '12px system-ui, sans-serif';
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const midX = plotLeft + plotW / 2;
            ctx.fillText(`ΔT: ${deltaT.toFixed(2)} ms   ΔV: ${deltaV.toFixed(2)} V`, midX, plotTop + 4);
          }
        }
      }

      if (buf.length < 2 || !connectedRef.current) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const msg = !connectedRef.current ? 'Lost of signal /  Backend Disconnected' : 'Waiting for samples…';
        ctx.fillText(msg, cw / 2, ch / 2);
      } else if (!showWaveformRef.current) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waveform display paused', cw / 2, ch / 2);
      } else if (pausedRef.current) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Acquisition paused', cw / 2, plotTop + 14);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [connected, showWaveform, zoomLevel, containerWidth, paused]);

  const isLive = connected && lastChunkAt != null && Date.now() - lastChunkAt < 500;
  const LIVE_PULSE = 'animate-pulse';
  const displayCountUI = Math.max(
    2,
    Math.min(sampleCount || 0, Math.round(DISPLAY_WAVEFORM_SAMPLES / (zoomLevel || 1)))
  );
  const maxScrollOffset = Math.max(0, (sampleCount || 0) - displayCountUI);
  const scrollStep = Math.max(20, Math.round(displayCountUI * 0.2));
  const scrollWindowMs = Math.round((displayCountUI / (meta.fs || 4000)) * 1000);
  const plotWUi = Math.max(1, (containerWidth || 800) - 40 - 20);
  const samplesPerPx = displayCountUI / plotWUi;

  // Real-time measurements จาก visible window (channel วัด = cursorChannel)
  const measureChannelMap = { ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4' };
  const measureBuf = bufferRef.current[measureChannelMap[cursorChannel]] || [];
  const measureEndIndex = Math.max(0, Math.min(measureBuf.length, measureBuf.length - (paused ? scrollOffset : 0)));
  const measureStartIndex = Math.max(0, measureEndIndex - displayCountUI);
  const measureSegment = measureBuf.length >= 2 ? measureBuf.slice(measureStartIndex, measureEndIndex) : [];
  const fs = meta.fs || 4000;

  let vpp = null;
  let freqHz = null;
  let dutyCycle = null;
  if (measureSegment.length >= 2) {
    let minV = measureSegment[0];
    let maxV = measureSegment[0];
    for (let i = 1; i < measureSegment.length; i++) {
      const v = Number(measureSegment[i]);
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    vpp = maxV - minV;
    const mid = (minV + maxV) / 2;
    let crossings = 0;
    for (let i = 0; i < measureSegment.length - 1; i++) {
      const a = Number(measureSegment[i]) - mid;
      const b = Number(measureSegment[i + 1]) - mid;
      if (a * b < 0) crossings++;
    }
    if (crossings >= 2) freqHz = (crossings / 2) * fs / measureSegment.length;
    let above = 0;
    for (let i = 0; i < measureSegment.length; i++) {
      if (Number(measureSegment[i]) > mid) above++;
    }
    dutyCycle = (above / measureSegment.length) * 100;
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* Toolbar card */}
      <div className="bg-gradient-to-r from-slate-50 to-white rounded-2xl border border-slate-200/80 shadow-sm overflow-visible">
        <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4">
          {/* Title + board + status */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300">
                  <Activity size={20} className="sm:hidden" strokeWidth={2} />
                  <Activity size={22} className="hidden sm:block" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                    Realtime Waveform
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {selectedBoardId
                      ? `Streaming from ${onlineBoards.find(b => b.id === selectedBoardId)?.name || selectedBoardId}`
                      : 'Streaming from simulated node'}
                  </div>
                </div>
              </div>
              {connected ? (
                isLive ? (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-700 border border-emerald-300/60 ${LIVE_PULSE}`}>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/15 text-amber-700 border border-amber-300/60">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Waiting for data…
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-200/80 text-slate-600 border border-slate-300/60">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  Disconnected
                </span>
              )}
            </div>

            {/* Streaming source: board selector */}
            <div className="shrink-0 flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Streaming from</span>
              <select
                value={selectedBoardId || ''}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Simulated Node</option>
                {onlineBoards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Right controls: View / Zoom / Scale */}
          <div className="flex items-center gap-2 sm:gap-3 flex-nowrap overflow-x-auto overflow-y-visible max-w-full pr-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* View options */}
            <div className="shrink-0">
              <button
                type="button"
                ref={viewButtonRef}
                onClick={() => {
                  const next = !viewPanelOpen;
                  setViewPanelOpen(next);
                }}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200/60 dark:border-cyan-700 text-cyan-900 dark:text-cyan-100 text-sm font-semibold hover:bg-cyan-100 dark:hover:bg-cyan-800 transition-colors"
                title="View & overlay options"
              >
                <Eye size={16} />
                View
              </button>
              {viewPanelOpen && (
                <div
                  ref={viewPopoverRef}
                  className="fixed w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-3 z-[999]"
                  style={{ top: viewPopoverPos.top, left: viewPopoverPos.left }}
                >
                  <div className="text-xs font-bold text-slate-500 mb-2">Show on chart</div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={showWaveform}
                        onChange={(e) => setShowWaveform(e.target.checked)}
                        className="w-4 h-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      Trace
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={showPlayhead}





                        onChange={(e) => setShowPlayhead(e.target.checked)}
                        className="w-4 h-4 shrink-0 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                      />
                      Playhead
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={showGrid}
                        onChange={(e) => setShowGrid(e.target.checked)}
                        className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                      />
                      Grid
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={showStats}
                        onChange={(e) => setShowStats(e.target.checked)}
                        className="w-4 h-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Stats
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={showCursor}
                        onChange={(e) => setShowCursor(e.target.checked)}
                        className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-600"
                      />
                      Cursor (T / V)
                    </label>
                    {showCursor && (
                      <>
                        <label className="flex items-center gap-2 py-1 pl-6 text-sm text-slate-600 select-none">
                          <input
                            type="checkbox"
                            checked={showCursor2}
                            onChange={(e) => setShowCursor2(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300"
                          />
                          Cursor 2 (ΔT / ΔV)
                        </label>
                        <div className="flex items-center gap-2 py-1 pl-6">
                          <span className="text-xs text-slate-500">Measure:</span>
                          <select
                            value={cursorChannel}
                            onChange={(e) => setCursorChannel(e.target.value)}
                            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                          >
                            <option value="ch1">CH1</option>
                            <option value="ch2">CH2</option>
                            <option value="ch3">CH3</option>
                            <option value="ch4">CH4</option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100">
                    <div className="text-xs font-bold text-slate-500 mb-1">Signals (analog)</div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input
                          type="checkbox"
                          checked={visibleSignals.ch1}
                          onChange={(e) =>
                            setVisibleSignals((prev) => ({ ...prev, ch1: e.target.checked }))
                          }
                          className="w-4 h-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        CH1
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input
                          type="checkbox"
                          checked={visibleSignals.ch2}
                          onChange={(e) =>
                            setVisibleSignals((prev) => ({ ...prev, ch2: e.target.checked }))
                          }
                          className="w-4 h-4 shrink-0 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                        />
                        CH2
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input
                          type="checkbox"
                          checked={visibleSignals.ch3}
                          onChange={(e) =>
                            setVisibleSignals((prev) => ({ ...prev, ch3: e.target.checked }))
                          }
                          className="w-4 h-4 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        CH3
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input
                          type="checkbox"
                          checked={visibleSignals.ch4}
                          onChange={(e) =>
                            setVisibleSignals((prev) => ({ ...prev, ch4: e.target.checked }))
                          }
                          className="w-4 h-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        CH4
                      </label>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 flex justify-end">
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                      onClick={() => setViewPanelOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Acquisition: Pause / Clear */}
            <div className="flex items-center gap-1 shrink-0 rounded-xl overflow-hidden border border-slate-200 bg-slate-100/80 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setPaused((p) => !p);
                  // when pausing/resuming, snap view to latest
                  setScrollOffset(0);
                }}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold rounded-lg transition-all ${paused ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:bg-amber-100 hover:text-amber-700'}`}
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={() => { bufferRef.current = { CH1: [], CH2: [], CH3: [], CH4: [] }; setSampleCount(0); setLastChunkAt(null); }}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold text-slate-600 hover:bg-rose-100 hover:text-rose-700 rounded-lg transition-all"
                title="Clear buffer"
              >
                <Trash2 size={16} />
                Clear
              </button>
            </div>

            {/* Scroll (only when paused) */}
            {paused && maxScrollOffset > 0 && (
              <div className="flex items-center gap-2 shrink-0 px-2 py-1 sm:py-1.5 rounded-xl border border-slate-200 bg-white/70">
                <span className="text-xs font-bold text-slate-500">Scroll</span>
                <button
                  type="button"
                  onClick={() => setScrollOffset((o) => Math.min(maxScrollOffset, o + scrollStep))}
                  className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors"
                  title="Scroll left (older)"
                >
                  <ChevronLeft size={16} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={maxScrollOffset}
                  step={1}
                  value={scrollOffset}
                  onChange={(e) => setScrollOffset(Number(e.target.value))}
                  className="w-24 accent-slate-600"
                  title="Scroll offset"
                />
                <button
                  type="button"
                  onClick={() => setScrollOffset((o) => Math.max(0, o - scrollStep))}
                  className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors"
                  title="Scroll right (newer)"
                >
                  <ChevronRight size={16} />
                </button>
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                  {Math.round((scrollOffset / (meta.fs || 4000)) * 1000)} ms
                </span>
              </div>
            )}

            {/* Zoom */}
            <div className="flex items-center gap-0.5 shrink-0 rounded-xl overflow-hidden border border-violet-200/80 bg-violet-50/50 p-0.5">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(32, z * 1.5))}
                className="p-2 text-violet-600 hover:bg-violet-200/80 rounded-lg transition-colors"
                title="Zoom in"
              >
                <ZoomIn size={18} />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(0.25, z / 1.5))}
                className="p-2 text-violet-600 hover:bg-violet-200/80 rounded-lg transition-colors"
                title="Zoom out"
              >
                <ZoomOut size={18} />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                className="px-2.5 py-1.5 text-xs font-bold text-violet-700 bg-violet-200/60 hover:bg-violet-300/80 rounded-lg transition-colors"
                title="Reset zoom"
              >
                1×
              </button>
            </div>

            {/* Y scale */}
            <div className="flex items-center gap-2 shrink-0 px-2 py-1 sm:py-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/50">
              <Gauge size={16} className="text-indigo-600 shrink-0" />
              <div className="flex rounded-lg overflow-hidden border border-indigo-200/60 bg-white">
                <button
                  type="button"
                  onClick={() => setScaleMode('auto')}
                  className={`px-2.5 py-1 text-xs font-semibold transition-all ${scaleMode === 'auto' ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:bg-indigo-100'}`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => setScaleMode('manual')}
                  className={`px-2.5 py-1 text-xs font-semibold transition-all ${scaleMode === 'manual' ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:bg-indigo-100'}`}
                >
                  Manual
                </button>
              </div>
              {scaleMode === 'manual' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    value={yMinManual}
                    onChange={(e) => setYMinManual(parseFloat(e.target.value) || 0)}
                    className="w-12 sm:w-14 px-2 py-1 text-xs font-medium border border-indigo-200 rounded-md bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                    placeholder="Min"
                  />
                  <span className="text-indigo-400 font-bold">→</span>
                  <input
                    type="number"
                    step="0.1"
                    value={yMaxManual}
                    onChange={(e) => setYMaxManual(parseFloat(e.target.value) || 0)}
                    className="w-12 sm:w-14 px-2 py-1 text-xs font-medium border border-indigo-200 rounded-md bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                    placeholder="Max"
                  />
                </div>
              )}
            </div>

            {showStats && sampleCount > 0 && (
              <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-200/80 text-slate-700 border border-slate-300/60">
                {sampleCount.toLocaleString()} samples
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs sm:text-sm text-slate-500">

      </p>

      {/* Legend */}
      <div className="flex items-center justify-between gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="inline-block w-8 h-0.5 rounded bg-[#0369a1]" aria-hidden />
            <span className="text-slate-600">CH1</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-8 h-0.5 rounded bg-[#ea580c]" aria-hidden />
            <span className="text-slate-600">CH2</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-8 h-0.5 rounded bg-[#16a34a]" aria-hidden />
            <span className="text-slate-600">CH3</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-8 h-0.5 rounded bg-[#7c3aed]" aria-hidden />
            <span className="text-slate-600">CH4</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-8 h-0.5 rounded border-t-2 border-dashed border-red-500" aria-hidden />
          <span className="text-slate-600 text-xs sm:text-sm">Playhead</span>
        </div>
        {showCursor && (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-block w-8 h-0.5 rounded border-t-2 border-dashed border-slate-800" aria-hidden />
              <span className="text-slate-600 text-xs sm:text-sm">Cursor 1</span>
            </div>
            {showCursor2 && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-8 h-0.5 rounded border-t-2 border-dashed border-blue-500" aria-hidden />
                <span className="text-slate-600 text-xs sm:text-sm">Cursor 2</span>
              </div>
            )}
          </>
        )}
      </div>
      
      <div
        ref={containerRef}
        className={`w-full bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden touch-none ${
          paused ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onWheel={(e) => {
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.preventDefault();
          const raw = e.deltaX !== 0 ? -e.deltaX : e.deltaY;
          const dir = raw > 0 ? 1 : -1; // positive => older (left)
          setScrollOffset((o) => Math.max(0, Math.min(maxScrollOffset, o + dir * scrollStep)));
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          const el = containerRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const plotLeft = 40;
          const plotW = Math.max(1, rect.width - 60);
          const localX = e.clientX - rect.left;
          const frac = Math.max(0, Math.min(1, (localX - plotLeft) / plotW));

          if (showCursorRef.current && localX >= plotLeft && localX <= plotLeft + plotW) {
            if (!showCursor2Ref.current) {
              activeCursorRef.current = 1;
              setCursorFrac(frac);
            } else {
              const f1 = cursorFracRef.current;
              const f2 = cursor2FracRef.current;
              const dist1 = Math.abs(frac - f1);
              const dist2 = Math.abs(frac - f2);
              if (dist1 <= dist2) {
                activeCursorRef.current = 1;
                setCursorFrac(frac);
              } else {
                activeCursorRef.current = 2;
                setCursor2Frac(frac);
              }
            }
            isDraggingCursorRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            return;
          }
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          panRef.current = { active: true, startX: e.clientX, startOffset: scrollOffsetRef.current || 0 };
          setIsPanning(true);
        }}
        onPointerMove={(e) => {
          if (isDraggingCursorRef.current) {
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const plotLeft = 40;
            const plotW = Math.max(1, rect.width - 60);
            const localX = e.clientX - rect.left;
            const frac = Math.max(0, Math.min(1, (localX - plotLeft) / plotW));
            if (activeCursorRef.current === 1) setCursorFrac(frac);
            else setCursor2Frac(frac);
            return;
          }
          if (!panRef.current.active) return;
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.preventDefault();
          const dx = e.clientX - panRef.current.startX;
          const deltaSamples = Math.round(dx * samplesPerPx);
          const next = panRef.current.startOffset + deltaSamples;
          setScrollOffset(Math.max(0, Math.min(maxScrollOffset, next)));
        }}
        onPointerUp={(e) => {
          if (isDraggingCursorRef.current) {
            isDraggingCursorRef.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            return;
          }
          if (!panRef.current.active) return;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          panRef.current.active = false;
          setIsPanning(false);
        }}
        onPointerCancel={(e) => {
          if (isDraggingCursorRef.current) {
            isDraggingCursorRef.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            return;
          }
          if (!panRef.current.active) return;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          panRef.current.active = false;
          setIsPanning(false);
        }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full max-w-full border-0"
          style={{ background: '#f1f5f9' }}
        />
      </div>
      <div className="space-y-1">
        {/* Running Graph + progress bar ซ่อนไว้ เพราะมี status ด้านบนแล้ว */}
        <div className="hidden">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Running Graph</span>
            {isLive ? (
              <span className="text-emerald-600 font-medium">Receiving data from Node</span>
            ) : connected ? (
              <span className="text-amber-600">Waiting for node to send chunk</span>
            ) : (
              <span className="text-slate-400">Lost of Signal / Backend Disconnected</span>
            )}
          </div>
          <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-75 ease-linear ${isLive ? 'bg-emerald-500' : 'bg-slate-400'}`}
              style={{ width: `${runProgress}%` }}
            />
          </div>
        </div>
        {/* Real-time measurements (จาก channel ที่เลือกใน View → Measure) */}
        <div className="mt-3 pt-3 border-t border-slate-200">
          <div className="text-xs font-bold text-slate-500 mb-2">Real-time measurements ({cursorChannel.toUpperCase()})</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Vpp</div>
              <div className="text-sm font-bold text-slate-800 tabular-nums">
                {vpp != null ? `${vpp.toFixed(2)} V` : '—'}
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Freq</div>
              <div className="text-sm font-bold text-slate-800 tabular-nums">
                {freqHz != null ? (freqHz >= 1000 ? `${(freqHz / 1000).toFixed(2)} kHz` : `${freqHz.toFixed(1)} Hz`) : '—'}
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Duty cycle</div>
              <div className="text-sm font-bold text-slate-800 tabular-nums">
                {dutyCycle != null ? `${dutyCycle.toFixed(1)} %` : '—'}
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Sampling rate</div>
              <div className="text-sm font-bold text-slate-800 tabular-nums">
                {fs >= 1000000 ? `${(fs / 1000000).toFixed(1)} MHz` : fs >= 1000 ? `${(fs / 1000).toFixed(1)} kHz` : `${fs} Hz`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 2. SETUP PAGE
// const SetupPage = () => (
//   <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-8">
//     <div className="flex justify-between items-end">
//       <div>
//         <h1 className="text-3xl font-bold">Test Case Setup</h1>
//         <p className="text-slate-500 mt-1">Configure your VCD and Firmware environment.</p>
//       </div>
//       <button className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2">
//         <Upload size={18} /> New Batch Setup
//       </button>
//     </div>

//     <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
//       <div className="lg:col-span-2 space-y-6">
//         <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center hover:border-blue-400 transition-all cursor-pointer group">
//           <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
//              <Upload size={32} className="text-blue-600" />
//           </div>
//           <h3 className="text-xl font-bold text-slate-800">Drag & Drop Test Files</h3>
//           <p className="text-slate-400 mt-2">Upload .VCD or Firmware .BIN files to begin</p>
//         </div>

//         <div className="bg-white rounded-2xl border border-slate-200 p-6">
//           <h3 className="font-bold mb-4 flex items-center gap-2"><FileCode className="text-blue-500" /> Loaded VCD Files</h3>
//           <div className="grid grid-cols-2 gap-4">
//             <FileItem name="test_case_A.vcd" size="1.2MB" />
//             <FileItem name="regression_v2.vcd" size="4.5MB" />
//           </div>
//         </div>
//       </div>

//       <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm h-fit">
//         <h3 className="font-bold mb-6 flex items-center gap-2"><Box className="text-orange-500" /> Config Editor</h3>
//         <div className="space-y-5">
//           <div className="space-y-1">
//             <label className="text-xs font-bold text-slate-400 uppercase">Config Name</label>
//             <input type="text" className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20" defaultValue="Default_Setup" />
//           </div>
//           <div className="space-y-1">
//             <label className="text-xs font-bold text-slate-400 uppercase">Firmware Model</label>
//             <select className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl">
//               <option>ERQM_v2.3_Release</option>
//               <option>ULP_Beta_0.9</option>
//             </select>
//           </div>
//           <button className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold shadow-xl hover:bg-black transition-all">Generate JSON Config</button>
//         </div>
//       </div>
//     </div>
//   </div>
// );

export default App;
