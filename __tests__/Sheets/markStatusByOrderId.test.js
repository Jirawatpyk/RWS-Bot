/**
 * Tests for Sheets/markStatusByOrderId.js
 */

jest.mock('googleapis', () => ({
  google: {
    sheets: jest.fn(() => ({
      spreadsheets: {
        values: {
          get: jest.fn(),
          update: jest.fn()
        }
      }
    }))
  }
}));

jest.mock('../../Google/auth', () => ({
  auth: 'mock-auth'
}));

jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logFail: jest.fn(),
  logProgress: jest.fn()
}));

jest.mock('../../Config/configs', () => ({
  jobLinks: {
    TrackingSheet: {
      sheetId: 'tracking-sheet-id',
      tabName: 'Tracking',
      orderIdColumn: 'A',
      statusColumn: 'B',
      pmNameColumn: 'C',
      receivedDateColumn: 'D'
    }
  }
}));

const { google } = require('googleapis');
const { logInfo, logFail, logProgress } = require('../../Logs/logger');
const { markStatusByOrderId, markStatusWithRetry, columnToIndex, MAX_ROWS } = require('../../Sheets/markStatusByOrderId');

describe('Sheets/markStatusByOrderId.js', () => {
  let mockGet;
  let mockUpdate;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet = jest.fn();
    mockUpdate = jest.fn().mockResolvedValue({ data: {} });

    google.sheets.mockReturnValue({
      spreadsheets: {
        values: {
          get: mockGet,
          update: mockUpdate
        }
      }
    });
  });

  describe('markStatusByOrderId', () => {
    describe('Successful Updates', () => {
      it('should update status when order ID is found', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [
              ['ORDER001'],
              ['ORDER002'],
              ['ORDER003']
            ]
          }
        });

        const result = await markStatusByOrderId('ORDER002', 'Completed');

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledTimes(2); // Status and PM name
        expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Updated status'));
      });

      it('should update with custom PM name', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [['ORDER001']]
          }
        });

        const result = await markStatusByOrderId('ORDER001', 'InProgress', 'CustomPM');

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: { values: [['CustomPM']] }
          })
        );
      });

      it('should use default PM name (DTP) when not specified', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [['ORDER001']]
          }
        });

        const result = await markStatusByOrderId('ORDER001', 'Done');

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: { values: [['DTP']] }
          })
        );
      });

      it('should calculate correct row number (offset by 5)', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [
              ['ORDER001'], // index 0 -> row 5
              ['ORDER002'], // index 1 -> row 6
              ['ORDER003']  // index 2 -> row 7
            ]
          }
        });

        await markStatusByOrderId('ORDER003', 'Completed');

        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            range: 'Tracking!B7' // index 2 + 5 = 7
          })
        );
      });

      it('should handle order ID with whitespace', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [['  ORDER001  ']]
          }
        });

        const result = await markStatusByOrderId('ORDER001', 'Done');

        expect(result).toBe(true);
      });

      it('should handle numeric order ID', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [['12345']]
          }
        });

        const result = await markStatusByOrderId(12345, 'Done');

        expect(result).toBe(true);
      });
    });

    describe('Order Not Found', () => {
      it('should return false when order ID is not found', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [
              ['ORDER001'],
              ['ORDER002']
            ]
          }
        });

        const result = await markStatusByOrderId('ORDER999', 'Completed');

        expect(result).toBe(false);
        expect(logProgress).toHaveBeenCalledWith(expect.stringContaining('not found'));
        expect(mockUpdate).not.toHaveBeenCalled();
      });

      it('should return false when sheet is empty', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: []
          }
        });

        const result = await markStatusByOrderId('ORDER001', 'Completed');

        expect(result).toBe(false);
      });

      it('should return false when values is undefined', async () => {
        mockGet.mockResolvedValue({
          data: {}
        });

        const result = await markStatusByOrderId('ORDER001', 'Completed');

        expect(result).toBe(false);
      });
    });

    describe('Error Handling', () => {
      it('should return false and log error on API failure', async () => {
        mockGet.mockRejectedValue(new Error('API Error'));

        const result = await markStatusByOrderId('ORDER001', 'Completed');

        expect(result).toBe(false);
        expect(logFail).toHaveBeenCalledWith(expect.stringContaining('Google Sheets API error'));
      });

      it('should handle update failure', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [['ORDER001']]
          }
        });
        mockUpdate.mockRejectedValue(new Error('Update failed'));

        const result = await markStatusByOrderId('ORDER001', 'Completed');

        expect(result).toBe(false);
        expect(logFail).toHaveBeenCalled();
      });
    });

    describe('Edge Cases', () => {
      it('should handle rows with empty cells', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [
              [],
              ['ORDER001'],
              [null],
              ['ORDER002']
            ]
          }
        });

        const result = await markStatusByOrderId('ORDER002', 'Done');

        expect(result).toBe(true);
      });

      it('should handle first order ID in list', async () => {
        mockGet.mockResolvedValue({
          data: {
            values: [['ORDER001'], ['ORDER002']]
          }
        });

        const result = await markStatusByOrderId('ORDER001', 'Done');

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            range: 'Tracking!B5' // index 0 + 5 = 5
          })
        );
      });
    });
  });

  describe('markStatusWithRetry', () => {
    it('should return true immediately when first attempt succeeds', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [['ORDER001']]
        }
      });

      const result = await markStatusWithRetry('ORDER001', 'Done');

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should use custom PM name', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [['ORDER001']]
        }
      });

      const result = await markStatusWithRetry('ORDER001', 'Done', 'CustomPM', null, 1);

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: { values: [['CustomPM']] }
        })
      );
    });

    it('should pass receivedDate to markStatusByOrderId', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [['ORDER001', '', '', '2026-01-24 11:35 PM']]
        }
      });

      const result = await markStatusWithRetry('ORDER001', 'Done', 'DTP', '2026-01-24 11:35 PM', 1);

      expect(result).toBe(true);
    });
  });

  describe('columnToIndex', () => {
    it('should convert single letter columns correctly', () => {
      expect(columnToIndex('A')).toBe(0);
      expect(columnToIndex('B')).toBe(1);
      expect(columnToIndex('Z')).toBe(25);
    });

    it('should convert double letter columns correctly', () => {
      expect(columnToIndex('AA')).toBe(26);
      expect(columnToIndex('AB')).toBe(27);
      expect(columnToIndex('AZ')).toBe(51);
      expect(columnToIndex('BA')).toBe(52);
    });

    it('should handle lowercase letters', () => {
      expect(columnToIndex('a')).toBe(0);
      expect(columnToIndex('aa')).toBe(26);
    });

    it('should return -1 for invalid input', () => {
      expect(columnToIndex(null)).toBe(-1);
      expect(columnToIndex(undefined)).toBe(-1);
      expect(columnToIndex('')).toBe(-1);
      expect(columnToIndex(123)).toBe(-1);
    });

    it('should handle typical sheet columns', () => {
      // Common columns used in the project
      expect(columnToIndex('F')).toBe(5);  // orderIdColumn
      expect(columnToIndex('N')).toBe(13); // receivedDateColumn
      expect(columnToIndex('B')).toBe(1);  // statusColumn
      expect(columnToIndex('C')).toBe(2);  // pmNameColumn
    });
  });

  describe('MAX_ROWS constant', () => {
    it('should be defined and have reasonable value', () => {
      expect(MAX_ROWS).toBeDefined();
      expect(typeof MAX_ROWS).toBe('number');
      expect(MAX_ROWS).toBeGreaterThan(0);
      expect(MAX_ROWS).toBeLessThanOrEqual(100000);
    });

    it('should be 10000', () => {
      expect(MAX_ROWS).toBe(10000);
    });
  });

  describe('Date Matching', () => {
    it('should match order by ID and receivedDate', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [
            ['ORDER001', '', '', '2026-01-24 10:00 AM'],
            ['ORDER001', '', '', '2026-01-24 11:35 PM'], // same order ID, different date
            ['ORDER002', '', '', '2026-01-25 09:00 AM']
          ]
        }
      });

      // Should match second row with matching date
      const result = await markStatusByOrderId('ORDER001', 'Done', 'DTP', '2026-01-24 11:35 PM');

      expect(result).toBe(true);
      // Row 6 = index 1 + 5
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'Tracking!B6'
        })
      );
    });

    it('should match first occurrence when no receivedDate provided', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [
            ['ORDER001', '', '', '2026-01-24 10:00 AM'],
            ['ORDER001', '', '', '2026-01-24 11:35 PM']
          ]
        }
      });

      const result = await markStatusByOrderId('ORDER001', 'Done', 'DTP', null);

      expect(result).toBe(true);
      // Should match first row (index 0 + 5 = 5)
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'Tracking!B5'
        })
      );
    });

    it('should fallback to Order ID only when date parsing fails', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [
            ['ORDER001', '', '', 'invalid-date'],
            ['ORDER002', '', '', '2026-01-25 09:00 AM']
          ]
        }
      });

      // Invalid date format should fallback to Order ID match
      const result = await markStatusByOrderId('ORDER001', 'Done', 'DTP', 'also-invalid');

      expect(result).toBe(true);
    });

    it('should match with 2 minute tolerance', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [
            ['ORDER001', '', '', '2026-01-24 11:35 PM']
          ]
        }
      });

      // 1 minute difference should match
      const result = await markStatusByOrderId('ORDER001', 'Done', 'DTP', '2026-01-24 11:36 PM');

      expect(result).toBe(true);
    });

    it('should not match when date difference exceeds tolerance', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [
            ['ORDER001', '', '', '2026-01-24 11:35 PM']
          ]
        }
      });

      // 5 minute difference should not match (exceeds 2 min tolerance)
      const result = await markStatusByOrderId('ORDER001', 'Done', 'DTP', '2026-01-24 11:40 PM');

      expect(result).toBe(false);
    });

    it('should handle different date formats', async () => {
      mockGet.mockResolvedValue({
        data: {
          values: [
            ['ORDER001', '', '', '2026-01-24 23:35:00'] // HH:mm:ss format
          ]
        }
      });

      // h:mm A format should match HH:mm:ss format
      const result = await markStatusByOrderId('ORDER001', 'Done', 'DTP', '2026-01-24 11:35 PM');

      expect(result).toBe(true);
    });
  });
});
