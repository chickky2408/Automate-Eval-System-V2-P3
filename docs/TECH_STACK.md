# Tech Stack & Development Tools

## 📋 สรุป Framework, Tools และภาษาที่ใช้ในการพัฒนา

---

## 🎯 ภาษาหลัก (Programming Languages)

### **JavaScript (ES6+)**
- **ใช้สำหรับ**: การพัฒนา frontend ทั้งหมด
- **รูปแบบ**: Modern JavaScript (ES6+ modules)
- **ไฟล์**: `.jsx` (React components), `.js` (utilities, services, hooks)

---

## ⚛️ Core Framework & Library

### **1. React 18.2.0**
- **ประเภท**: UI Library / Framework
- **ใช้สำหรับ**: สร้าง User Interface แบบ Component-based
- **เวอร์ชัน**: ^18.2.0
- **คุณสมบัติที่ใช้**:
  - Functional Components
  - Hooks (useState, useEffect, etc.)
  - JSX syntax
  - React DOM rendering

### **2. Vite 5.0.0**
- **ประเภท**: Build Tool / Development Server
- **ใช้สำหรับ**: 
  - Development server (hot reload)
  - Production build
  - Module bundling
- **เวอร์ชัน**: ^5.0.0
- **Scripts**:
  - `npm run dev` - Start development server
  - `npm run build` - Build for production
  - `npm run preview` - Preview production build

---

## 🎨 Styling & UI

### **1. Tailwind CSS 3.3.5**
- **ประเภท**: Utility-first CSS Framework
- **ใช้สำหรับ**: Styling ทุกหน้าและ component
- **เวอร์ชัน**: ^3.3.5
- **คุณสมบัติ**:
  - Utility classes (เช่น `bg-blue-600`, `rounded-xl`, `p-4`)
  - Responsive design
  - Custom theme configuration
- **Config**: `tailwind.config.js`

### **2. PostCSS 8.4.31**
- **ประเภท**: CSS Processor
- **ใช้สำหรับ**: Process CSS (Tailwind, Autoprefixer)
- **Config**: `postcss.config.js`

### **3. Autoprefixer 10.4.16**
- **ประเภท**: PostCSS Plugin
- **ใช้สำหรับ**: เพิ่ม vendor prefixes อัตโนมัติ

### **4. Lucide React 0.300.0**
- **ประเภท**: Icon Library
- **ใช้สำหรับ**: Icons ทั่วทั้งแอปพลิเคชัน
- **Icons ที่ใช้**: Menu, X, LayoutDashboard, Settings, PlayCircle, Cpu, History, Bell, Upload, FileCode, Box, Search, CheckCircle2, AlertCircle, Clock, Zap, Database, ChevronRight, Grid3x3, List, Filter, Terminal, Wifi, WifiOff, HardDrive, RefreshCw, Download, Activity, XCircle, Eye, MoreVertical, ArrowUp, ArrowDown, Square, Tag, FileJson, StopCircle, Command, Copy, Play, Layers, Monitor

---

## 🗄️ State Management

### **Zustand 4.5.7**
- **ประเภท**: State Management Library
- **ใช้สำหรับ**: จัดการ global state ของแอปพลิเคชัน
- **เวอร์ชัน**: ^4.5.7
- **Store**: `src/store/useTestStore.js`
- **จัดการข้อมูล**:
  - Boards (บอร์ดทั้งหมด)
  - Jobs (งาน/บัตช์ทั้งหมด)
  - System Health
  - Notifications
  - Uploaded Files
  - Test Commands
- **Actions**: addBoard, updateBoardTag, moveJobUp, moveJobDown, stopFile, addUploadedFile, etc.

---

## 🖥️ Terminal & SSH

### **1. @xterm/xterm 6.0.0**
- **ประเภท**: Terminal Emulator Library
- **ใช้สำหรับ**: WebSSH Terminal ใน Board Details
- **เวอร์ชัน**: ^6.0.0

### **2. @xterm/addon-fit 0.11.0**
- **ประเภท**: XTerm Addon
- **ใช้สำหรับ**: Auto-fit terminal size
- **เวอร์ชัน**: ^0.11.0

---

## 🛠️ Development Tools

### **TypeScript Types (Optional)**
- **@types/react 18.2.0**: Type definitions for React
- **@types/react-dom 18.2.0**: Type definitions for React DOM
- **หมายเหตุ**: โปรเจคนี้ใช้ JavaScript แต่มี type definitions สำหรับ IDE support

### **@vitejs/plugin-react 4.2.0**
- **ประเภท**: Vite Plugin
- **ใช้สำหรับ**: Enable React support ใน Vite

---

## 📁 Project Structure

```
frontend-management/
├── src/
│   ├── App.jsx              # Main application component
│   ├── main.jsx             # Entry point
│   ├── index.css            # Global styles
│   ├── components/          # React components
│   │   ├── Common/
│   │   ├── JobManagement/
│   │   └── ResourceLibrary/
│   ├── hooks/               # Custom React hooks
│   │   ├── useApi.js
│   │   ├── useFileUpload.js
│   │   ├── useJobQueue.js
│   │   └── useJsonConfig.js
│   ├── services/            # API services
│   │   ├── api.js           # Real API calls
│   │   └── mockApi.js       # Mock API for development
│   ├── store/               # State management
│   │   └── useTestStore.js  # Zustand store
│   └── utils/               # Utility functions
│       ├── apiEndpoints.js
│       ├── constants.js
│       ├── errorHandler.js
│       ├── fileHelpers.js
│       └── sessionStorage.js
├── public/                  # Static assets
├── dist/                    # Production build output
├── package.json             # Dependencies & scripts
├── tailwind.config.js       # Tailwind configuration
├── postcss.config.js        # PostCSS configuration
└── index.html              # HTML entry point
```

---

## 🔧 Build & Development

### **Development**
```bash
npm run dev
```
- เริ่ม development server ที่ `http://localhost:5173`
- Hot Module Replacement (HMR)
- Fast refresh

### **Production Build**
```bash
npm run build
```
- Build optimized production bundle
- Output: `dist/` folder
- Minified & optimized code

### **Preview Production Build**
```bash
npm run preview
```
- Preview production build locally

---

## 📦 Package Manager

### **npm**
- ใช้ npm สำหรับจัดการ dependencies
- `package.json` - กำหนด dependencies และ scripts
- `package-lock.json` - Lock file versions

---

## 🌐 Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6+ features
- CSS Grid & Flexbox
- WebSocket support (for future backend integration)

---

## 📚 Additional Libraries & Features

### **Browser APIs ใช้**
- **Clipboard API**: สำหรับ copy commands (`navigator.clipboard.writeText`)
- **File API**: สำหรับ file upload และ drag & drop
- **Session Storage**: สำหรับเก็บ client ID (simulate authentication)
- **Fetch API**: สำหรับ API calls (พร้อมไว้สำหรับ backend integration)

---

##  Architecture Pattern

### **Component-Based Architecture**
- Functional Components
- Custom Hooks สำหรับ reusable logic
- Service Layer สำหรับ API calls
- Centralized State Management (Zustand)

### **Separation of Concerns**
- **Components**: UI presentation
- **Hooks**: Business logic & side effects
- **Services**: API communication
- **Store**: Global state
- **Utils**: Helper functions

---

## 📝 Code Style

- **JSX**: React component syntax
- **ES6 Modules**: `import` / `export`
- **Arrow Functions**: Modern function syntax
- **Destructuring**: Object & array destructuring
- **Template Literals**: String interpolation
- **Optional Chaining**: `?.` operator

---

## 🔄 Version Control

- **Git**: Version control system
- **.gitignore**: Excludes `node_modules/`, `dist/`

---

## 📖 Documentation Files

- `README.md` - Project overview & setup
- `API_DOCUMENTATION.md` - API specifications
- `BACKEND_INTEGRATION.md` - Backend integration guide
- `REQUIREMENT_CHECKLIST.md` - Requirements checklist
- `TECH_STACK.md` - This file

---

## ✅ Summary

| Category | Technology | Version |
|----------|-----------|---------|
| **Language** | JavaScript (ES6+) | - |
| **UI Framework** | React | 18.2.0 |
| **Build Tool** | Vite | 5.0.0 |
| **CSS Framework** | Tailwind CSS | 3.3.5 |
| **State Management** | Zustand | 4.5.7 |
| **Icons** | Lucide React | 0.300.0 |
| **Terminal** | @xterm/xterm | 6.0.0 |
| **Package Manager** | npm | - |

---

**สรุป**: โปรเจคนี้ใช้ **React + Vite + Tailwind CSS + Zustand** เป็น tech stack หลัก พัฒนาด้วย **JavaScript (ES6+)** และใช้ **npm** เป็น package manager
