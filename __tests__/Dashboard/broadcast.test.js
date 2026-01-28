/**
 * Test Suite: Dashboard/utils/broadcast.js
 *
 * ทดสอบการส่งข้อมูลผ่าน WebSocket
 * - การ initialize WebSocket server
 * - การ broadcast สถานะไปยัง clients ทั้งหมด
 * - การส่ง log entries ไปยัง clients
 * - จัดการกรณีที่ WebSocket ยังไม่ถูก initialize
 * - จัดการกรณีที่ client ไม่พร้อมรับข้อมูล
 */

describe('broadcast', () => {
  let broadcast;
  let mockTaskStatusStore;
  let mockWss;
  let mockClient1;
  let mockClient2;
  let mockClient3;
  let consoleWarnSpy;
  let consoleLogSpy;

  beforeEach(() => {
    // ล้าง cache ของ module ทุกครั้ง
    jest.resetModules();

    // Mock console methods
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    // Mock taskStatusStore
    mockTaskStatusStore = {
      getAllStatus: jest.fn().mockReturnValue({
        pending: 5,
        success: 10,
        error: 2
      })
    };
    jest.mock('../../Dashboard/statusManager/taskStatusStore', () => mockTaskStatusStore);

    // สร้าง mock clients
    mockClient1 = {
      readyState: 1, // OPEN
      send: jest.fn()
    };

    mockClient2 = {
      readyState: 1, // OPEN
      send: jest.fn()
    };

    mockClient3 = {
      readyState: 0, // CONNECTING (ไม่พร้อม)
      send: jest.fn()
    };

    // สร้าง mock WebSocket server
    mockWss = {
      clients: new Set([mockClient1, mockClient2, mockClient3])
    };

    // โหลด module หลัง mock เสร็จ
    broadcast = require('../../Dashboard/utils/broadcast');
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('initWebSocket', () => {
    it('should initialize WebSocket server successfully', () => {
      // Arrange & Act
      broadcast.initWebSocket(mockWss);

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✅ WebSocket server initialized in broadcast.js'
      );
    });

    it('should store WebSocket server for later use', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.broadcastStatus();

      // Assert
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(mockClient1.send).toHaveBeenCalled();
    });

    it('should allow re-initialization with new server', () => {
      // Arrange
      const mockWss2 = {
        clients: new Set([mockClient1])
      };
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.initWebSocket(mockWss2);

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should accept null as WebSocket server', () => {
      // Arrange & Act
      broadcast.initWebSocket(null);

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✅ WebSocket server initialized in broadcast.js'
      );
    });
  });

  describe('broadcastStatus', () => {
    it('should warn when WebSocket server is not initialized', () => {
      // Arrange
      // ไม่เรียก initWebSocket

      // Act
      broadcast.broadcastStatus();

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '⚠️ WebSocket server not initialized, cannot broadcast.'
      );
    });

    it('should broadcast status to all ready clients', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.broadcastStatus();

      // Assert
      const expectedPayload = JSON.stringify({
        type: 'updateStatus',
        pending: 5,
        success: 10,
        error: 2
      });

      expect(mockClient1.send).toHaveBeenCalledWith(expectedPayload);
      expect(mockClient2.send).toHaveBeenCalledWith(expectedPayload);
      expect(mockClient3.send).not.toHaveBeenCalled(); // readyState !== 1
    });

    it('should not send to clients with readyState !== 1', () => {
      // Arrange
      mockClient1.readyState = 0; // CONNECTING
      mockClient2.readyState = 2; // CLOSING
      mockClient3.readyState = 3; // CLOSED

      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.broadcastStatus();

      // Assert
      expect(mockClient1.send).not.toHaveBeenCalled();
      expect(mockClient2.send).not.toHaveBeenCalled();
      expect(mockClient3.send).not.toHaveBeenCalled();
    });

    it('should call getAllStatus to get current status', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.broadcastStatus();

      // Assert
      expect(mockTaskStatusStore.getAllStatus).toHaveBeenCalled();
    });

    it('should handle empty clients set gracefully', () => {
      // Arrange
      const emptyWss = {
        clients: new Set()
      };
      broadcast.initWebSocket(emptyWss);

      // Act & Assert (ไม่ควรเกิด error)
      expect(() => broadcast.broadcastStatus()).not.toThrow();
    });

    it('should send correct JSON format with all required fields', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.broadcastStatus();

      // Assert
      const sentData = mockClient1.send.mock.calls[0][0];
      const parsedData = JSON.parse(sentData);

      expect(parsedData).toHaveProperty('type', 'updateStatus');
      expect(parsedData).toHaveProperty('pending', 5);
      expect(parsedData).toHaveProperty('success', 10);
      expect(parsedData).toHaveProperty('error', 2);
    });

    it('should broadcast different status values correctly', () => {
      // Arrange
      mockTaskStatusStore.getAllStatus.mockReturnValue({
        pending: 0,
        success: 0,
        error: 0
      });
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.broadcastStatus();

      // Assert
      const expectedPayload = JSON.stringify({
        type: 'updateStatus',
        pending: 0,
        success: 0,
        error: 0
      });

      expect(mockClient1.send).toHaveBeenCalledWith(expectedPayload);
    });

    it('should handle multiple consecutive broadcasts', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.broadcastStatus();
      broadcast.broadcastStatus();
      broadcast.broadcastStatus();

      // Assert
      expect(mockClient1.send).toHaveBeenCalledTimes(3);
      expect(mockClient2.send).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendLogToClients', () => {
    it('should return early when WebSocket server is not initialized', () => {
      // Arrange
      const log = { level: 'info', message: 'Test log' };

      // Act
      broadcast.sendLogToClients(log);

      // Assert
      expect(mockClient1.send).not.toHaveBeenCalled();
      expect(mockClient2.send).not.toHaveBeenCalled();
    });

    it('should send log to all ready clients', () => {
      // Arrange
      const log = { level: 'info', message: 'Test log entry', timestamp: Date.now() };
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.sendLogToClients(log);

      // Assert
      const expectedPayload = JSON.stringify({
        type: 'logEntry',
        log: log
      });

      expect(mockClient1.send).toHaveBeenCalledWith(expectedPayload);
      expect(mockClient2.send).toHaveBeenCalledWith(expectedPayload);
      expect(mockClient3.send).not.toHaveBeenCalled(); // readyState !== 1
    });

    it('should not send to clients with readyState !== 1', () => {
      // Arrange
      mockClient1.readyState = 2; // CLOSING
      mockClient2.readyState = 3; // CLOSED
      const log = { message: 'Test' };

      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.sendLogToClients(log);

      // Assert
      expect(mockClient1.send).not.toHaveBeenCalled();
      expect(mockClient2.send).not.toHaveBeenCalled();
    });

    it('should handle different log object structures', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      const logs = [
        { level: 'error', message: 'Error occurred', stack: 'stack trace' },
        { level: 'warn', message: 'Warning message' },
        { message: 'Simple message' },
        {}
      ];

      // Act & Assert
      logs.forEach(log => {
        mockClient1.send.mockClear();
        broadcast.sendLogToClients(log);

        const expectedPayload = JSON.stringify({
          type: 'logEntry',
          log: log
        });

        expect(mockClient1.send).toHaveBeenCalledWith(expectedPayload);
      });
    });

    it('should handle null log', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.sendLogToClients(null);

      // Assert
      const expectedPayload = JSON.stringify({
        type: 'logEntry',
        log: null
      });

      expect(mockClient1.send).toHaveBeenCalledWith(expectedPayload);
    });

    it('should handle undefined log', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.sendLogToClients(undefined);

      // Assert
      const sentData = mockClient1.send.mock.calls[0][0];
      const parsedData = JSON.parse(sentData);

      expect(parsedData.type).toBe('logEntry');
      expect(parsedData.log).toBeUndefined();
    });

    it('should handle empty clients set gracefully', () => {
      // Arrange
      const emptyWss = {
        clients: new Set()
      };
      broadcast.initWebSocket(emptyWss);
      const log = { message: 'Test' };

      // Act & Assert
      expect(() => broadcast.sendLogToClients(log)).not.toThrow();
    });

    it('should send correct JSON format with type and log fields', () => {
      // Arrange
      const log = { level: 'debug', message: 'Debug message', data: { key: 'value' } };
      broadcast.initWebSocket(mockWss);

      // Act
      broadcast.sendLogToClients(log);

      // Assert
      const sentData = mockClient1.send.mock.calls[0][0];
      const parsedData = JSON.parse(sentData);

      expect(parsedData).toHaveProperty('type', 'logEntry');
      expect(parsedData).toHaveProperty('log');
      expect(parsedData.log).toEqual(log);
    });

    it('should handle multiple consecutive log sends', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);
      const log1 = { message: 'Log 1' };
      const log2 = { message: 'Log 2' };
      const log3 = { message: 'Log 3' };

      // Act
      broadcast.sendLogToClients(log1);
      broadcast.sendLogToClients(log2);
      broadcast.sendLogToClients(log3);

      // Assert
      expect(mockClient1.send).toHaveBeenCalledTimes(3);
      expect(mockClient2.send).toHaveBeenCalledTimes(3);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle mixed broadcasts and log sends', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);
      const log = { message: 'Test log' };

      // Act
      broadcast.broadcastStatus();
      broadcast.sendLogToClients(log);
      broadcast.broadcastStatus();

      // Assert
      expect(mockClient1.send).toHaveBeenCalledTimes(3);

      const calls = mockClient1.send.mock.calls;
      expect(JSON.parse(calls[0][0]).type).toBe('updateStatus');
      expect(JSON.parse(calls[1][0]).type).toBe('logEntry');
      expect(JSON.parse(calls[2][0]).type).toBe('updateStatus');
    });

    it('should handle re-initialization and continue broadcasting', () => {
      // Arrange
      const newClient = {
        readyState: 1,
        send: jest.fn()
      };
      const newWss = {
        clients: new Set([newClient])
      };

      broadcast.initWebSocket(mockWss);
      broadcast.broadcastStatus();

      // Act
      broadcast.initWebSocket(newWss);
      broadcast.broadcastStatus();

      // Assert
      expect(mockClient1.send).toHaveBeenCalledTimes(1); // เฉพาะครั้งแรก
      expect(newClient.send).toHaveBeenCalledTimes(1); // หลัง re-init
    });

    it('should handle client readyState changes between broadcasts', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);

      // Act & Assert
      broadcast.broadcastStatus();
      expect(mockClient1.send).toHaveBeenCalledTimes(1);

      // เปลี่ยน readyState
      mockClient1.readyState = 2; // CLOSING

      broadcast.broadcastStatus();
      expect(mockClient1.send).toHaveBeenCalledTimes(1); // ไม่เพิ่ม
    });
  });

  describe('Edge cases', () => {
    it('should handle WebSocket server with null clients', () => {
      // Arrange
      const nullClientsWss = {
        clients: null
      };

      // Act & Assert
      expect(() => broadcast.initWebSocket(nullClientsWss)).not.toThrow();
    });

    it('should handle client.send throwing error', () => {
      // Arrange
      mockClient1.send.mockImplementation(() => {
        throw new Error('Send failed');
      });
      broadcast.initWebSocket(mockWss);

      // Act & Assert
      expect(() => broadcast.broadcastStatus()).toThrow('Send failed');
    });

    it('should handle very large log objects', () => {
      // Arrange
      broadcast.initWebSocket(mockWss);
      const largeLog = {
        message: 'Test',
        data: Array(1000).fill({ key: 'value', nested: { deep: 'data' } })
      };

      // Act & Assert
      expect(() => broadcast.sendLogToClients(largeLog)).not.toThrow();
      expect(mockClient1.send).toHaveBeenCalled();
    });
  });
});
