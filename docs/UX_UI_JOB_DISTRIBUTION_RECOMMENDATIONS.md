# UX/UI Recommendations for Job Distribution Modes

## Overview
Document provides detailed UX/UI recommendations for implementing Job Distribution Modes (Auto-assign, Targeted) in the Evaluation System.

**Note**: Both Auto-assign and Targeted modes support multiple board selection.

---

## 1. Board Selection Interface

### 1.1 Distribution Mode Selector
**Location**: Test Setup / Create Job Modal

```
┌─────────────────────────────────────────────────────────┐
│  Job Distribution Mode                                 │
├─────────────────────────────────────────────────────────┤
│  ○ Auto-assign  [System picks from available boards]   │
│  ● Targeted     [Select specific boards]               │
└─────────────────────────────────────────────────────────┘
```

**UX Guidelines**:
- Use radio buttons for mutually exclusive modes
- Show helper text explaining each mode
- Auto-assign should be default
- Both modes support multiple board selection

### 1.2 Board Selection UI

#### For Auto-assign Mode
```
┌─────────────────────────────────────────────────────────┐
│  Number of Boards to Use                               │
├─────────────────────────────────────────────────────────┤
│                                                       │
│  Available Boards: 4                                   │
│  Online: 3 | Offline: 1                                │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Use all available boards (3)                    │  │
│  │ ○ Use specific number: [ 3 ] boards            │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  System will automatically assign boards when available │
│                                                       │
└─────────────────────────────────────────────────────────┘
```

#### For Targeted Mode (Multiple Boards)
```
┌─────────────────────────────────────────────────────────┐
│  Select Boards                                         │
├─────────────────────────────────────────────────────────┤
│  [Select All] [Clear All]                             │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ☑ ZYBO-001  [● Online]  CPU: 45°C  Load: 20% │  │
│  │ ☑ ZYBO-002  [● Online]  CPU: 52°C  Load: 35% │  │
│  │ ☐ ZYBO-003  [○ Offline] CPU: --    Load: --  │  │
│  │ ☑ ZYBO-004  [● Online]  CPU: 48°C  Load: 15% │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  Selected: 3 boards                                   │
└─────────────────────────────────────────────────────────┘
```

**UX Guidelines**:
- Show real-time board status (Online/Offline/Busy)
- Display board health metrics (CPU temp, load)
- Disable offline/busy boards for selection
- Show count of selected boards
- Add "Select All" / "Clear All" buttons for multiple selection

---

## 2. Job Creation Flow

### 2.1 Step-by-Step Wizard
```
┌─────────────────────────────────────────────────────────┐
│  Create New Job                           Step 2/4    │
├─────────────────────────────────────────────────────────┤
│                                                       │
│  [Files] → [Distribution] → [Settings] → [Confirm]    │
│                                                       │
│  Job Distribution Mode:                                 │
│  ○ Auto-assign                                        │
│  ● Targeted                                           │
│                                                       │
│  Select Boards:                                        │
│  [Board Selection UI as above]                         │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ℹ️ This job will run on 3 boards simultaneously  │  │
│  │    Estimated time: ~5 minutes per board          │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│                    [Back]  [Next]                    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Compact Form (Advanced Users)
```
┌─────────────────────────────────────────────────────────┐
│  Quick Job Setup                                      │
├─────────────────────────────────────────────────────────┤
│  VCD File:     [Demo1.vcd v]                         │
│  Firmware:     [demo_erom_2.erom v]                   │
│                                                       │
│  Distribution: [Auto-assign ▼]                         │
│                                                       │
│  Boards:       [ZYBO-001, ZYBO-002, ZYBO-004]       │
│                (3 selected) [Change...]                │
│                                                       │
│  Priority:     [Normal ▼]                             │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │  [Create Job]  [Save as Test Case]              │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Job Status Display

### 3.1 Job Card with Distribution Info
```
┌─────────────────────────────────────────────────────────┐
│  Job #abc12f  [Targeted: 3 boards]                  │
├─────────────────────────────────────────────────────────┤
│  Demo1.vcd + demo_erom_2.erom                       │
│                                                       │
│  Progress: ████████████░░░░░░░░░░░ 50%              │
│  Status: Running (3/3 boards active)                 │
│                                                       │
│  Board Status:                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ZYBO-001: ████████████░░░░░░░░░░░ 50% ● Run │  │
│  │ ZYBO-002: ████████████████░░░░░░ 70% ● Run │  │
│  │ ZYBO-004: █████████░░░░░░░░░░░░░ 30% ● Run │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  Started: 2 minutes ago                                │
│  ETA: ~3 minutes                                      │
│                                                       │
│  [View Details] [Stop Job] [Cancel]                   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Detailed Job View (Multi-Board Execution)
```
┌─────────────────────────────────────────────────────────┐
│  Job #abc12f - Multi-Board Execution                 │
├─────────────────────────────────────────────────────────┤
│                                                       │
│  Test Configuration:                                    │
│  • VCD: Demo1.vcd                                     │
│  • Firmware: demo_erom_2.erom                         │
│  • Mode: Targeted                                     │
│  • Boards: 3 selected                                 │
│                                                       │
│  ────────────────────────────────────────────────────   │
│                                                       │
│  Overall Progress: ████████████░░░░░░░░░░░ 50%       │
│  Status: Running                                      │
│                                                       │
│  Board Execution Details:                               │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ZYBO-001                                       │  │
│  │ Progress: ████████████░░░░░░░░░░░ 50%          │  │
│  │ Status: ● Running                               │  │
│  │ Current Step: Executing test...                  │  │
│  │ Started: 2 min ago | ETA: 2 min                │  │
│  │ [View Logs] [Stop This Board]                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ZYBO-002                                       │  │
│  │ Progress: ████████████████░░░░░░ 70%          │  │
│  │ Status: ● Running                               │  │
│  │ Current Step: Executing test...                  │  │
│  │ Started: 2 min ago | ETA: 1 min                │  │
│  │ [View Logs] [Stop This Board]                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ZYBO-004                                       │  │
│  │ Progress: █████████░░░░░░░░░░░░░ 30%          │  │
│  │ Status: ● Running                               │  │
│  │ Current Step: Executing test...                  │  │
│  │ Started: 2 min ago | ETA: 4 min                │  │
│  │ [View Logs] [Stop This Board]                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ────────────────────────────────────────────────────   │
│                                                       │
│  [Stop All Boards] [View Results] [Export Report]     │
│                                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Queue Management with Distribution Info

### 4.1 Queue List View
```
┌─────────────────────────────────────────────────────────┐
│  Job Queue                                           │
├─────────────────────────────────────────────────────────┤
│  [Filter: All ▼] [Sort: Priority ▼] [Refresh]       │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Job #abc12f  [Targeted: 3 boards]             │  │
│  │ Demo1.vcd + demo_erom_2.erom                    │  │
│  │ Priority: High | Status: Running (3/3)           │  │
│  │ ████████████░░░░░░░░░░░ 50%                    │  │
│  │ [Drag to reorder] [⋮]                           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Job #def34g  [Auto-assign: 2 boards]          │  │
│  │ Demo2.vcd + demo_ulp_1.ulp                     │  │
│  │ Priority: Normal | Status: Pending              │  │
│  │ ░░░░░░░░░░░░░░░░░░░░ 0%                      │  │
│  │ [Drag to reorder] [⋮]                           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Job #ghi56h  [Targeted: ZYBO-002]             │  │
│  │ Demo3.vcd + demo_erom_1.erom                    │  │
│  │ Priority: Low | Status: Pending                │  │
│  │ ░░░░░░░░░░░░░░░░░░░░ 0%                      │  │
│  │ [Drag to reorder] [⋮]                           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Error Handling & Edge Cases

### 5.1 Board Unavailable Error
```
┌─────────────────────────────────────────────────────────┐
│  ⚠️ Board Availability Issue                          │
├─────────────────────────────────────────────────────────┤
│                                                       │
│  The following boards are not available:               │
│                                                       │
│  • ZYBO-003 - Offline                                 │
│  • ZYBO-005 - Busy (Job #xyz78)                      │
│                                                       │
│  Options:                                              │
│  ○ Run on available boards only (2/4)                 │
│  ○ Wait for all boards to become available             │
│  ○ Cancel job                                         │
│                                                       │
│  [Continue] [Cancel]                                   │
│                                                       │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Partial Failure in Multi-Board Execution
```
┌─────────────────────────────────────────────────────────┐
│  ⚠️ Partial Job Completion                            │
├─────────────────────────────────────────────────────────┤
│                                                       │
│  Job #abc12f completed with mixed results:             │
│                                                       │
│  ✅ ZYBO-001 - Passed (2.5s)                         │
│  ❌ ZYBO-002 - Failed: Timeout (5.0s)                 │
│  ✅ ZYBO-004 - Passed (2.3s)                         │
│                                                       │
│  Success Rate: 2/3 (67%)                             │
│                                                       │
│  Actions:                                              │
│  • [View Failed Log]                                  │
│  • [Retry Failed Boards]                               │
│  • [Export Report]                                    │
│  • [Create Bug Report]                                │
│                                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Visual Design Guidelines

### 6.1 Color Coding
- **Auto-assign**: Blue (automatic/system-controlled)
- **Targeted**: Green (user-specified)

### 6.2 Status Indicators
- **Online**: ● Green dot
- **Offline**: ○ Gray dot
- **Busy**: 🟡 Yellow dot
- **Error**: 🔴 Red dot

### 6.3 Progress Bars
- Use consistent progress bar design across all views
- Show per-board progress in multi-board execution
- Use color to indicate status (green=success, red=error, blue=running)

### 6.4 Icons
- Auto-assign: 🔄 (refresh/automatic)
- Targeted: 🎯 (target)
- Board: 🖥️ (monitor)
- Success: ✅
- Failure: ❌
- Warning: ⚠️

---

## 7. Accessibility Considerations

- Use ARIA labels for all interactive elements
- Ensure keyboard navigation works for all controls
- Provide text alternatives for icons
- Use sufficient color contrast (WCAG AA minimum)
- Support screen readers for status announcements

---

## 8. Mobile Responsiveness

- Stack board selection on smaller screens
- Use collapsible sections for detailed views
- Implement swipe gestures for job actions
- Use bottom sheet for quick actions on mobile

---

## 9. Performance Optimizations

- Use virtual scrolling for large board lists
- Implement lazy loading for job history
- Cache board status updates
- Debounce rapid state changes
- Use WebSocket for real-time updates

---

## 10. User Feedback & Help

### 10.1 Tooltips
- Hover over distribution mode icons for explanation
- Show board status details on hover
- Display job configuration summary on hover

### 10.2 Contextual Help
- "What's this?" links next to complex options
- Inline help text for first-time users
- Video tutorials for multi-board execution

### 10.3 Onboarding
- Guided tour for new users
- Progressive disclosure of advanced features
- Sample jobs with different distribution modes
