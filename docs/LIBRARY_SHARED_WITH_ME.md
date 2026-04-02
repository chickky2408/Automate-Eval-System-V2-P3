# Library — "Shared with me" filter

สรุปการทำงานของ filter **Shared with me** ในหน้า Library ทั้ง 3 แท็บ

## แหล่งข้อมูล

- **All / Shared with me**: ข้อมูล Set และ Test case ดึงจาก API `GET /profiles/all-test-cases` (รวมทุก profile ใน DB แต่ละรายการมี `_ownerId`, `_ownerName`).
- **File in Library**: ใช้รายการไฟล์จาก `GET /api/files` (ทุกไฟล์ในระบบ มี `ownerId` ถ้ามี).

## 1. Set Library

- **Mine**: แสดงเฉพาะ Set ของ profile ปัจจุบัน (`savedTestCaseSets` จาก store).
- **All**: แสดง Set ของทุก profile (จาก `allProfilesTestData.savedTestCaseSets`).
- **Shared with me**: แสดงเฉพาะ Set ที่ **เจ้าของไม่ใช่เรา** — กรองจาก `allProfilesTestData.savedTestCaseSets` โดย `set._ownerId && set._ownerId !== activeProfileId`.

## 2. Test Cases Library

- **Mine**: แสดงเฉพาะ test case ของ profile ปัจจุบัน (และจาก Set ของเรา).
- **All**: แสดง test case จากทุก profile (รวมจาก Set ทุกคน).
- **Shared with me**: แสดงเฉพาะ test case ที่ **เจ้าของไม่ใช่เรา** — กรองจาก `libraryRawRows` โดย `tc._ownerId !== activeProfileId && tc._ownerId` มีค่า.

(รายการใน Library มาจากทั้ง `savedTestCases` และ items ใน `savedTestCaseSets` แต่ละรายการมี `_ownerId` จาก backend.)

## 3. File in Library

- **Mine**: แสดงไฟล์ที่ `ownerId` เป็น null หรือเท่ากับ `activeProfileId` (ของเรา).
- **All**: แสดงทุกไฟล์.
- **Shared with me**: แสดงเฉพาะไฟล์ที่ **มีเจ้าของและไม่ใช่เรา** — กรองโดย `f.ownerId && f.ownerId !== activeProfileId`.

หมายเหตุ: ฝั่ง backend เก็บ `owner_id` ตอน upload (เช่น จาก client id). ถ้าแอปใช้ profile id เป็นตัวระบุผู้ upload จะสอดคล้องกับ filter ด้านบน.

## สรุป

| Tab            | Shared with me = แสดงเฉพาะ |
|----------------|----------------------------|
| Set Library    | Set ที่ _ownerId ≠ เรา      |
| Test Cases     | Test case ที่ _ownerId ≠ เรา |
| File in Library| ไฟล์ที่ ownerId ≠ เรา      |
