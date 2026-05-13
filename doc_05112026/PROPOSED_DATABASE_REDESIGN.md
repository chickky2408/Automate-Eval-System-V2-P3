# แผนปรับปรุงสถาปัตยกรรมฐานข้อมูล (Proposed Database Redesign)
**สถานะ:** ร่างข้อเสนอ (แก้ไข Critical & Important) | **วันที่อัปเดต:** 12 พฤษภาคม 2026

---

## 1. แผนผังความสัมพันธ์ (Complete ER Diagram)

```mermaid
erDiagram
    %% ── Profiles (Identity) ────────────────────────────
    profiles ||--o{ notifications : "receives"
    profiles ||--o{ files         : "owns"
    profiles ||--o{ testCases     : "owns"
    profiles ||--o{ testSets      : "owns"
    profiles ||--o{ jobs          : "created by"

    %% ── Hardware ──────────────────────────────────────
    boards ||--|| boardStatus : "has current telemetry"
    boards ||--o{ jobs        : "assigned to"

    %% ── Unified Tagging ───────────────────────────────
    tags ||--o{ tagsMap : "defines"
    tagsMap }o--|| files      : "tags FILE"
    tagsMap }o--|| testCases  : "tags TEST_CASE"
    tagsMap }o--|| testSets   : "tags TEST_SET"
    tagsMap }o--|| jobs       : "tags JOB"
    tagsMap }o--|| results    : "tags RESULT"

    %% ── File Library ──────────────────────────────────
    testCases }o--|| files : "uses vcdFileId"
    testCases }o--|| files : "uses binFileId"
    testCases }o--|| files : "uses linFileId"
    testCases }o--|| files : "uses mdiFileId"

    %% ── Test Definitions ──────────────────────────────
    testSets     ||--o{ testSetItems : "contains"
    testSetItems }o--|| testCases    : "links"

    %% ── Execution ─────────────────────────────────────
    jobs     ||--o{ jobItems  : "executes"
    jobItems }o--|| testCases : "instance of"
    jobItems ||--o| results   : "produces"

    %% ── Result Files (Option C) ───────────────────────
    results ||--o{ resultFiles : "has output files"

    %% ══════════════════════════════════════════════════
    %% TABLE DEFINITIONS
    %% ══════════════════════════════════════════════════

    profiles {
        uuid         id          PK  "Share key / Profile ID"
        varchar(255) name
        datetime     createdAt
        datetime     updatedAt
    }

    notifications {
        uuid         id         PK
        uuid         profileId  FK  "null = broadcast to all"
        enum         type       "JOB_DONE | JOB_ERROR | SYSTEM"
        varchar(255) title
        text         message
        boolean      isRead     "Default false"
        json         data       "Extra payload"
        datetime     createdAt
    }

    boards {
        varchar(64)  id              PK  "MAC or Unique ID"
        varchar(255) name
        char(17)     macAddress
        varchar(64)  ipAddress           "Last known IP from heartbeat"
        varchar(128) model
        varchar(128) firmwareVersion
        datetime     createdAt
    }

    boardStatus {
        varchar(64) boardId      PK, FK
        enum        state        "online | offline | busy | error"
        datetime    lastHeartbeat
        float       cpuTemp
        float       cpuLoad
        float       ramUsage
        varchar(64) currentJobId
        enum        fpgaStatus   "active | idle | error | unknown"
        enum        armStatus    "online | busy | error | unknown"
        datetime    updatedAt
    }

    files {
        uuid         id          PK
        varchar(255) filename
        enum         fileType    "VCD | EROM | ULP | TXT | SCRIPT | OTHER"
        varchar(512) storagePath
        char(64)     checksum    "SHA-256"
        bigint       sizeBytes
        uuid         ownerId     FK "→ profiles.id"
        enum         visibility  "private | team | public"
        datetime     uploadedAt
        datetime     updatedAt
    }

    tags {
        uuid         id       PK
        varchar(100) name     "Unique"
        varchar(32)  tagColor "Palette Key"
        datetime     createdAt
    }

    tagsMap {
        uuid tagId      PK, FK
        uuid entityId   PK      "ID of File, Job, Result etc."
        enum entityType PK      "FILE | TEST_CASE | TEST_SET | JOB | RESULT"
        datetime createdAt
    }

    testCases {
        uuid         id         PK
        varchar(255) name
        uuid         vcdFileId  FK
        uuid         binFileId  FK
        uuid         linFileId  FK
        uuid         mdiFileId  FK
        uuid         ownerId    FK  "→ profiles.id"
        smallint     tryCount   "Default 1"
        enum         visibility "private | team | public"
        datetime     createdAt
        datetime     updatedAt
    }

    testSets {
        uuid         id         PK
        varchar(255) name
        uuid         ownerId    FK  "→ profiles.id"
        enum         visibility "private | team | public"
        datetime     createdAt
        datetime     updatedAt
    }

    testSetItems {
        uuid     id             PK
        uuid     setId          FK
        uuid     testCaseId     FK
        smallint executionOrder
    }

    jobs {
        uuid         id                  PK
        varchar(255) name
        enum         status              "pending | running | completed | cancelled | failed | board_lost | timed_out | retrying"
        varchar(64)  assignedBoardId     FK  "→ boards.id"
        uuid         profileId           FK  "→ profiles.id"
        varchar(255) configName
        smallint     progress            "0-100"
        smallint     priority            "Higher = first in queue"
        smallint     timeoutSeconds      "Default 60"
        boolean      enablePicoscope     "Default false"
        varchar(255) currentStep         "Human-readable run step"
        text         errorMessage
        %% ── Audit Trail (Board Assignment) ──
        datetime     boardAssignedAt     "เวลาที่ Assign บอร์ดให้ Job นี้"
        datetime     boardLostAt         "เวลาที่บอร์ดหาย (null = ปกติ)"
        datetime     lastBoardHeartbeat  "Heartbeat ล่าสุดที่ได้รับ"
        smallint     retryCount          "จำนวนรอบ Retry จาก Board Loss"
        enum         retryReason         "null | BOARD_LOST | TIMED_OUT"
        datetime     createdAt
        datetime     startedAt
        datetime     completedAt
    }

    jobItems {
        uuid         id           PK
        uuid         jobId        FK
        uuid         testCaseId   FK
        enum         status       "pending | running | completed | stopped | error"
        enum         result       "pass | fail | unknown"
        smallint     order
        smallint     tryCount
        text         errorMessage
        datetime     startedAt
        datetime     completedAt
    }

    results {
        uuid        id          PK
        uuid        jobItemId   FK
        uuid        jobId       FK
        varchar(64) boardId     FK  "→ boards.id"
        boolean     passed
        float       duration    "Seconds"
        datetime    startedAt
        datetime    completedAt
        jsonb       metricsJSON "CRC errors, packet count etc."
        jsonb       snapshotData "Snapshot of filenames at run time"
        datetime    createdAt
    }

    resultFiles {
        uuid         id          PK
        uuid         resultId    FK  "→ results.id"
        enum         fileType    "LOG | WAVEFORM | REPORT"
        varchar(512) storagePath
        varchar(255) filename
        bigint       sizeBytes
        char(64)     checksum    "SHA-256"
        datetime     createdAt
    }
```

---

## 2. การแก้ไขที่ดำเนินการ (Applied Fixes)

### 🔴 Critical
| ปัญหา | การแก้ไข |
| :--- | :--- |
| ขาดตาราง `profiles` | เพิ่มตาราง `profiles` และทำ FK จากทุกตารางที่มี `ownerId` |
| ขาดตาราง `notifications` | เพิ่มตาราง `notifications` พร้อม `profileId` FK |
| `boards` ขาด `ipAddress` | เพิ่มคอลัมน์ `ipAddress varchar(64)` เพื่อเก็บ IP ล่าสุดจาก Heartbeat |

### 🟡 Important
| ปัญหา | การแก้ไข |
| :--- | :--- |
| `jobItems` ขาด Timestamps | เพิ่ม `startedAt`, `completedAt`, `errorMessage` |
| `jobs` เก็บฟิลด์สำคัญใน JSON blob | ย้าย `priority`, `timeoutSeconds`, `enablePicoscope`, `currentStep`, `errorMessage`, `profileId`, `configName` ออกเป็นคอลัมน์จริง |
| `results` ขาด Timing | เพิ่ม `startedAt` และ `completedAt` |
| `boardStatus` ขาด FPGA/ARM | เพิ่ม `fpgaStatus` และ `armStatus` เป็น ENUM |

### 🛡️ Fault Tolerance (Board Loss)
| ปัญหา | การแก้ไข |
| :--- | :--- |
| Job ค้างเมื่อบอร์ดหาย | เพิ่ม `status = board_lost` และ `timed_out` ใน Job ENUM |
| ไม่รู้ว่าบอร์ดหายเมื่อไหร่ | เพิ่ม `boardLostAt` และ `lastBoardHeartbeat` ใน `jobs` |
| ไม่รู้ว่า Retry เพราะอะไร | เพิ่ม `retryCount` + `retryReason (BOARD_LOST\|TIMED_OUT)` ใน `jobs` |
| ไม่รู้เวลาที่ Assign บอร์ด | เพิ่ม `boardAssignedAt` ใน `jobs` (Audit Trail แบบ Lightweight) |

---

## 3. สรุปตารางทั้งหมด (14 Tables)

| # | Table | กลุ่ม | หน้าที่ |
| :-- | :--- | :--- | :--- |
| 1 | `profiles` | Identity | ทะเบียนผู้ใช้งาน (No-login Profile) |
| 2 | `notifications` | Identity | การแจ้งเตือนของระบบ |
| 3 | `boards` | Hardware | ทะเบียนบอร์ด Zybo (Static + IP) |
| 4 | `boardStatus` | Hardware | สถานะ Real-time + FPGA/ARM |
| 5 | `files` | Library | ไฟล์ที่ User Upload |
| 6 | `tags` | Tagging | มาสเตอร์ Tag (Unified) |
| 7 | `tagsMap` | Tagging | Polymorphic Tag Mapping |
| 8 | `testCases` | Test Logic | นิยามชุดไฟล์ทดสอบ |
| 9 | `testSets` | Test Logic | กลุ่ม Test Suite |
| 10 | `testSetItems` | Test Logic | ลำดับ Test Case ใน Set |
| 11 | `jobs` | Execution | คุมการรัน (พร้อม Priority/Timeout) |
| 12 | `jobItems` | Execution | เนื้องานย่อย (พร้อม Timestamps) |
| 13 | `results` | Results | ผลลัพธ์ (พร้อม startedAt/completedAt) |
| 14 | `resultFiles` | Results | ไฟล์ผลลัพธ์ (Log/Waveform/Report) |

---

[🔙 กลับไปยังแผนผังหลัก](./FE_MENU_API_DB_MAPPING.md)
