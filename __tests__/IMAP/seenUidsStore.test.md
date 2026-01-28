# Test Documentation: seenUidsStore.test.js

## การครอบคลุมการทดสอบ (Test Coverage)

**Coverage: 100%** ทุกบรรทัด ทุก branch ทุกฟังก์ชัน

## ภาพรวมโมดูล

โมดูล `seenUidsStore.js` ทำหน้าที่จัดเก็บและโหลด UIDs ของอีเมลที่เคยประมวลผลแล้ว เพื่อป้องกันการประมวลผลซ้ำ

### ฟังก์ชันหลัก

1. **loadSeenUids(mailboxName)** - โหลด UIDs จากไฟล์ JSON
2. **saveSeenUids(mailboxName, seenSet)** - บันทึก Set ของ UIDs ลงไฟล์

## การทดสอบที่ครอบคลุม (24 Test Cases)

### 1. loadSeenUids Tests (8 tests)

| Test Case | จุดประสงค์ | Edge Case |
|-----------|-----------|-----------|
| Load existing file | ตรวจสอบการโหลดไฟล์ที่มีข้อมูล | - |
| File not found | จัดการเมื่อไฟล์ไม่มี (ครั้งแรก) | ENOENT error |
| Invalid JSON | จัดการข้อมูล JSON ที่เสียหาย | Parse error |
| Empty file | จัดการไฟล์ว่าง | - |
| Empty array | โหลดอาร์เรย์ว่าง | - |
| Large UIDs | ทดสอบกับข้อมูลจำนวนมาก (5000 items) | Performance |
| Special characters | sanitize ชื่อ mailbox ที่มีอักขระพิเศษ | Path safety |
| Duplicate UIDs | Set จะลบค่าซ้ำอัตโนมัติ | Data integrity |

### 2. saveSeenUids Tests (7 tests)

| Test Case | จุดประสงค์ | Edge Case |
|-----------|-----------|-----------|
| Save normal Set | บันทึกข้อมูลปกติ | - |
| Save empty Set | บันทึก Set ว่าง | - |
| Write errors | จัดการ error ในการเขียนไฟล์ | EACCES error |
| Large Set | บันทึกข้อมูลจำนวนมาก (2000 items) | Performance |
| Special characters | sanitize ชื่อ mailbox เมื่อบันทึก | Path safety |
| String UIDs | รองรับ UID แบบ string | Type flexibility |
| Disk full | จัดการเมื่อ disk เต็ม | ENOSPC error |

### 3. Integration Scenarios (3 tests)

| Test Case | จุดประสงค์ |
|-----------|-----------|
| Load and save sequence | ทดสอบ workflow ที่สมบูรณ์: โหลด → แก้ไข → บันทึก |
| Concurrent operations | หลาย mailbox ทำงานพร้อมกัน |
| Failed save retry | ตรวจสอบความสมบูรณ์ของข้อมูลหลัง error |

### 4. Edge Cases & Boundary Conditions (5 tests)

| Test Case | จุดประสงค์ |
|-----------|-----------|
| Null/undefined mailbox | ตรวจสอบว่า throw error (ไม่ handle) |
| Very long names | ชื่อ mailbox ยาว 255 ตัวอักษร |
| Mixed data types | UID ที่มีทั้ง number และ string |
| Readonly filesystem | จัดการ EROFS error |
| Preserve order | Set รักษาลำดับ insertion order |

### 5. Bug Documentation (1 test)

| Test Case | ปัญหาที่พบ |
|-----------|-----------|
| Unused limitedUids variable | บรรทัด 29-30: สร้าง `limitedUids` แต่ไม่ได้ใช้ ทำให้ limit 1000 items ไม่ทำงาน |

## Bugs ที่ค้นพบในโค้ดต้นฉบับ

### Bug: ไม่มีการ Limit UIDs ที่ 1000 รายการ

**Location:** `seenUidsStore.js` lines 29-30

```javascript
// บรรทัด 29: สร้างแต่ไม่ใช้
const limitedUids = uidArray.slice(-1000);

// บรรทัด 30: บันทึกทั้งหมดแทนที่จะใช้ limitedUids
fs.writeFileSync(pathToFile, JSON.stringify([...seenSet]));
```

**ผลกระทบ:**
- ไฟล์จะเติบโตแบบไม่จำกัดตามจำนวน UIDs
- อาจทำให้ performance ลดลงเมื่อมี UIDs หลายพัน/หลายหมื่นรายการ
- ใช้ memory และ disk space มากกว่าที่จำเป็น

**วิธีแก้ไขที่แนะนำ:**

```javascript
function saveSeenUids(mailboxName, seenSet) {
  const pathToFile = getSeenUidsPath(mailboxName);
  try {
    const uidArray = [...seenSet];
    const limitedUids = uidArray.slice(-1000);
    // แก้ไข: ใช้ limitedUids แทน [...seenSet]
    fs.writeFileSync(pathToFile, JSON.stringify(limitedUids));
    logInfo(`💾 Saved seen UIDs for ${mailboxName}: ${limitedUids.length} items (limited to 1000)`);
  } catch (err) {
    logFail(`❌ Failed to save seen UIDs for ${mailboxName}:`, err);
  }
}
```

## Dependencies ที่ Mock

- **fs** - ระบบไฟล์ (readFileSync, writeFileSync)
- **logger** - การ log (logInfo, logFail)

## การรันเทสต์

```bash
# รันเฉพาะ seenUidsStore tests
npm test -- __tests__/IMAP/seenUidsStore.test.js

# รันพร้อม coverage
npm test -- __tests__/IMAP/seenUidsStore.test.js --coverage --collectCoverageFrom="IMAP/seenUidsStore.js"
```

## ผลการทดสอบ

```
Test Suites: 1 passed
Tests:       24 passed
Coverage:    100% (Statements, Branches, Functions, Lines)
```

## Best Practices ที่ใช้ในการทดสอบ

1. ✅ **AAA Pattern** (Arrange-Act-Assert) ในทุกเทสต์
2. ✅ **Descriptive test names** - ชื่อเทสต์บอกพฤติกรรมที่คาดหวัง
3. ✅ **Isolated tests** - แต่ละเทสต์ไม่ขึ้นต่อกัน
4. ✅ **Mock external dependencies** - fs และ logger ถูก mock ทั้งหมด
5. ✅ **Test edge cases** - ครอบคลุม error cases, boundary values
6. ✅ **Document bugs** - บันทึก bugs ที่พบผ่านเทสต์
7. ✅ **Clear comments** - มี comment อธิบาย complex scenarios

## สิ่งที่เรียนรู้จากการทดสอบ

1. **Set behavior** - Set ใน JavaScript ลบค่าซ้ำและรักษาลำดับ insertion order
2. **Error handling** - โค้ดต้นฉบับจัดการ error ได้ดี (catch-all ใน loadSeenUids)
3. **Path sanitization** - การใช้ regex `/[^\w]/g` เพื่อ sanitize filename ปลอดภัย
4. **Potential issues** - การไม่ validate input (null/undefined) อาจทำให้เกิด runtime error

## แนะนำการปรับปรุงเพิ่มเติม

1. **Input validation** - เพิ่มการตรวจสอบ mailboxName ก่อนใช้
2. **Fix limit bug** - แก้ไขการใช้ limitedUids variable
3. **Add file locking** - ป้องกัน concurrent write operations
4. **Atomic writes** - ใช้ temp file + rename เพื่อ atomic operations
