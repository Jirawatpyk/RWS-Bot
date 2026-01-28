/**
 * Test Suite: Dashboard/statusManager/taskStatusStore.js
 *
 * ทดสอบการจัดการสถานะของ task ทั้งหมด
 * - การเพิ่มจำนวนสถานะแต่ละประเภท
 * - การดึงข้อมูลสถานะทั้งหมด
 * - การรีเซ็ตสถานะกลับเป็นค่าเริ่มต้น
 */

describe('taskStatusStore', () => {
  let taskStatusStore;

  beforeEach(() => {
    // ล้าง cache ของ module เพื่อให้ได้ instance ใหม่ทุกครั้ง
    jest.resetModules();
    taskStatusStore = require('../../Dashboard/statusManager/taskStatusStore');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllStatus', () => {
    it('should return initial status with all counters at zero', () => {
      // Arrange & Act
      const status = taskStatusStore.getAllStatus();

      // Assert
      expect(status).toEqual({
        pending: 0,
        success: 0,
        error: 0
      });
    });

    it('should return a copy of status object (not reference)', () => {
      // Arrange
      const status1 = taskStatusStore.getAllStatus();
      status1.pending = 999;

      // Act
      const status2 = taskStatusStore.getAllStatus();

      // Assert
      expect(status2.pending).toBe(0);
      expect(status2).not.toBe(status1);
    });
  });

  describe('incrementStatus', () => {
    it('should increment pending counter when type is "pending"', () => {
      // Arrange & Act
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.incrementStatus('pending');

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status.pending).toBe(2);
      expect(status.success).toBe(0);
      expect(status.error).toBe(0);
    });

    it('should increment success counter when type is "success"', () => {
      // Arrange & Act
      taskStatusStore.incrementStatus('success');
      taskStatusStore.incrementStatus('success');
      taskStatusStore.incrementStatus('success');

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status.success).toBe(3);
      expect(status.pending).toBe(0);
      expect(status.error).toBe(0);
    });

    it('should increment error counter when type is "error"', () => {
      // Arrange & Act
      taskStatusStore.incrementStatus('error');

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status.error).toBe(1);
      expect(status.pending).toBe(0);
      expect(status.success).toBe(0);
    });

    it('should increment multiple status types independently', () => {
      // Arrange & Act
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.incrementStatus('success');
      taskStatusStore.incrementStatus('error');
      taskStatusStore.incrementStatus('error');
      taskStatusStore.incrementStatus('error');

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status.pending).toBe(2);
      expect(status.success).toBe(1);
      expect(status.error).toBe(3);
    });

    it('should do nothing when type is invalid', () => {
      // Arrange
      const initialStatus = taskStatusStore.getAllStatus();

      // Act
      taskStatusStore.incrementStatus('invalid');
      taskStatusStore.incrementStatus('unknown');
      taskStatusStore.incrementStatus('');

      // Assert
      const finalStatus = taskStatusStore.getAllStatus();
      expect(finalStatus).toEqual(initialStatus);
    });

    it('should do nothing when type is null', () => {
      // Arrange
      const initialStatus = taskStatusStore.getAllStatus();

      // Act
      taskStatusStore.incrementStatus(null);

      // Assert
      const finalStatus = taskStatusStore.getAllStatus();
      expect(finalStatus).toEqual(initialStatus);
    });

    it('should do nothing when type is undefined', () => {
      // Arrange
      const initialStatus = taskStatusStore.getAllStatus();

      // Act
      taskStatusStore.incrementStatus(undefined);

      // Assert
      const finalStatus = taskStatusStore.getAllStatus();
      expect(finalStatus).toEqual(initialStatus);
    });

    it('should do nothing when type is a number', () => {
      // Arrange
      const initialStatus = taskStatusStore.getAllStatus();

      // Act
      taskStatusStore.incrementStatus(123);

      // Assert
      const finalStatus = taskStatusStore.getAllStatus();
      expect(finalStatus).toEqual(initialStatus);
    });

    it('should do nothing when type is an object', () => {
      // Arrange
      const initialStatus = taskStatusStore.getAllStatus();

      // Act
      taskStatusStore.incrementStatus({ type: 'pending' });

      // Assert
      const finalStatus = taskStatusStore.getAllStatus();
      expect(finalStatus).toEqual(initialStatus);
    });
  });

  describe('resetStatus', () => {
    it('should reset all counters to zero', () => {
      // Arrange
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.incrementStatus('success');
      taskStatusStore.incrementStatus('error');
      expect(taskStatusStore.getAllStatus()).not.toEqual({
        pending: 0,
        success: 0,
        error: 0
      });

      // Act
      taskStatusStore.resetStatus();

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status).toEqual({
        pending: 0,
        success: 0,
        error: 0
      });
    });

    it('should reset even when counters have large values', () => {
      // Arrange
      for (let i = 0; i < 1000; i++) {
        taskStatusStore.incrementStatus('pending');
      }
      for (let i = 0; i < 500; i++) {
        taskStatusStore.incrementStatus('success');
      }
      for (let i = 0; i < 250; i++) {
        taskStatusStore.incrementStatus('error');
      }

      // Act
      taskStatusStore.resetStatus();

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status).toEqual({
        pending: 0,
        success: 0,
        error: 0
      });
    });

    it('should allow incrementing after reset', () => {
      // Arrange
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.resetStatus();

      // Act
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.incrementStatus('success');

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status).toEqual({
        pending: 1,
        success: 1,
        error: 0
      });
    });

    it('should work correctly with multiple resets', () => {
      // Arrange & Act
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.resetStatus();

      taskStatusStore.incrementStatus('success');
      taskStatusStore.incrementStatus('success');
      taskStatusStore.resetStatus();

      taskStatusStore.incrementStatus('error');

      // Assert
      const status = taskStatusStore.getAllStatus();
      expect(status).toEqual({
        pending: 0,
        success: 0,
        error: 1
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete workflow: increment -> get -> reset -> increment', () => {
      // Phase 1: Initial increments
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.incrementStatus('pending');
      expect(taskStatusStore.getAllStatus().pending).toBe(2);

      // Phase 2: More increments
      taskStatusStore.incrementStatus('success');
      expect(taskStatusStore.getAllStatus().success).toBe(1);

      // Phase 3: Reset
      taskStatusStore.resetStatus();
      expect(taskStatusStore.getAllStatus()).toEqual({
        pending: 0,
        success: 0,
        error: 0
      });

      // Phase 4: New increments after reset
      taskStatusStore.incrementStatus('error');
      const finalStatus = taskStatusStore.getAllStatus();
      expect(finalStatus).toEqual({
        pending: 0,
        success: 0,
        error: 1
      });
    });

    it('should maintain state across multiple getAllStatus calls', () => {
      // Arrange
      taskStatusStore.incrementStatus('pending');
      taskStatusStore.incrementStatus('success');
      taskStatusStore.incrementStatus('error');

      // Act
      const status1 = taskStatusStore.getAllStatus();
      const status2 = taskStatusStore.getAllStatus();
      const status3 = taskStatusStore.getAllStatus();

      // Assert
      expect(status1).toEqual(status2);
      expect(status2).toEqual(status3);
      expect(status1).toEqual({
        pending: 1,
        success: 1,
        error: 1
      });
    });
  });
});
