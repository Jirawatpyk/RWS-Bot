/**
 * Tests for Sheets/sheetReader.js
 *
 * ทดสอบการอ่านข้อมูลจาก Google Sheets API
 * - การอ่านลิงก์และ timestamp จากชีต
 * - การแปลงตัวอักษรคอลัมน์เป็น index
 * - การจัดการ edge cases และ error handling
 */

jest.mock('googleapis', () => ({
  google: {
    sheets: jest.fn(() => ({
      spreadsheets: {
        values: {
          get: jest.fn()
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
    DATASheet: {
      sheetId: 'test-data-sheet-id',
      tabName: 'NOTOUCH',
      LinksColumn: 'Q',        // Column index 16 (Q = 17th column, 0-indexed = 16)
      ReceviedDate: 'C',       // Column index 2
      StartRow: 2
    },
    MainSheet: {
      sheetId: 'test-main-sheet-id',
      tabName: 'AcceptLinks',
      LinksColumn: 'A',        // Column index 0
      ReceviedDate: 'B',       // Column index 1
      StartRow: 5
    },
    NoTimestampSheet: {
      sheetId: 'test-no-timestamp-sheet-id',
      tabName: 'NoTimestamp',
      LinksColumn: 'A',
      // ReceviedDate not defined
      StartRow: 2
    }
  }
}));

const { google } = require('googleapis');
const { logProgress, logFail } = require('../../Logs/logger');
const { readLinksFromSheet } = require('../../Sheets/sheetReader');

describe('Sheets/sheetReader.js', () => {
  let mockGet;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet = jest.fn();
    google.sheets.mockReturnValue({
      spreadsheets: {
        values: {
          get: mockGet
        }
      }
    });
  });

  describe('readLinksFromSheet', () => {
    describe('Successful Operations', () => {
      it('should read links and timestamps from DATASheet', async () => {
        const mockRows = [
          // Row 2: Full data
          [
            '', '', '2026-01-23 10:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/1'
          ],
          // Row 3: Full data
          [
            '', '', '2026-01-23 11:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/2'
          ],
          // Row 4: Missing timestamp - should be skipped
          [
            '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/3'
          ],
          // Row 5: Missing link - should be skipped
          [
            '', '', '2026-01-23 12:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            ''
          ],
          // Row 6: Valid data with spaces
          [
            '', '', '  2026-01-23 13:00:00  ', '', '', '', '', '', '', '', '', '', '', '', '', '',
            '  https://example.com/task/4  '
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(mockGet).toHaveBeenCalledWith({
          spreadsheetId: 'test-data-sheet-id',
          range: 'NOTOUCH!A2:Z'
        });

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({
          url: 'https://example.com/task/1',
          rowNumber: 2,
          timestamp: '2026-01-23 10:00:00'
        });
        expect(result[1]).toEqual({
          url: 'https://example.com/task/2',
          rowNumber: 3,
          timestamp: '2026-01-23 11:00:00'
        });
        // Row 4 with trimmed spaces
        expect(result[2]).toEqual({
          url: 'https://example.com/task/4',
          rowNumber: 6,
          timestamp: '2026-01-23 13:00:00'
        });
      });

      it('should read links from MainSheet with different StartRow', async () => {
        const mockRows = [
          // Row 5
          ['https://example.com/task/100', '2026-01-23 14:00:00'],
          // Row 6
          ['https://example.com/task/101', '2026-01-23 15:00:00']
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('MainSheet');

        expect(mockGet).toHaveBeenCalledWith({
          spreadsheetId: 'test-main-sheet-id',
          range: 'AcceptLinks!A5:Z'
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          url: 'https://example.com/task/100',
          rowNumber: 5,
          timestamp: '2026-01-23 14:00:00'
        });
        expect(result[1]).toEqual({
          url: 'https://example.com/task/101',
          rowNumber: 6,
          timestamp: '2026-01-23 15:00:00'
        });
      });

      it('should handle config without StartRow (default to 2)', async () => {
        const mockRows = [
          ['https://example.com/task/200', '2026-01-23 16:00:00']
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        // Temporarily add a config without StartRow
        const { jobLinks } = require('../../Config/configs');
        jobLinks.DefaultStartRow = {
          sheetId: 'test-default-sheet-id',
          tabName: 'DefaultTab',
          LinksColumn: 'A',
          ReceviedDate: 'B'
          // No StartRow defined
        };

        const result = await readLinksFromSheet('DefaultStartRow');

        expect(mockGet).toHaveBeenCalledWith({
          spreadsheetId: 'test-default-sheet-id',
          range: 'DefaultTab!A2:Z'  // Should default to row 2
        });

        expect(result).toHaveLength(1);
        expect(result[0].rowNumber).toBe(2);

        // Cleanup
        delete jobLinks.DefaultStartRow;
      });
    });

    describe('Empty and No Data Scenarios', () => {
      it('should return empty array when sheet has no data', async () => {
        mockGet.mockResolvedValue({
          data: { values: null }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toEqual([]);
        expect(logProgress).toHaveBeenCalledWith('⚠️ ไม่พบลิงก์ในชีต NOTOUCH');
      });

      it('should return empty array when sheet has empty rows', async () => {
        mockGet.mockResolvedValue({
          data: { values: [] }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toEqual([]);
        expect(logProgress).toHaveBeenCalledWith('⚠️ ไม่พบลิงก์ในชีต NOTOUCH');
      });

      it('should return empty array when all rows are invalid', async () => {
        const mockRows = [
          // No link, has timestamp
          ['', '', '2026-01-23 10:00:00'],
          // Has link, no timestamp
          ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'https://example.com/task/1'],
          // Empty row
          [],
          // Whitespace only
          ['  ', '  ', '   ']
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toEqual([]);
      });
    });

    describe('Config Without ReceviedDate Column', () => {
      it('should skip all rows when ReceviedDate is not configured', async () => {
        const mockRows = [
          ['https://example.com/task/1'],
          ['https://example.com/task/2']
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('NoTimestampSheet');

        // All rows should be skipped because timestamp is required
        expect(result).toEqual([]);
      });
    });

    describe('Error Handling', () => {
      it('should throw error when config not found', async () => {
        await expect(
          readLinksFromSheet('NonExistentSheet')
        ).rejects.toThrow('❌ ไม่พบ config ของชีต NonExistentSheet');
      });

      it('should handle API errors and return empty array', async () => {
        mockGet.mockRejectedValue(new Error('API quota exceeded'));

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toEqual([]);
        expect(logFail).toHaveBeenCalledWith(
          '❌ อ่านชีตล้มเหลว: NOTOUCH',
          'API quota exceeded',
          true
        );
      });

      it('should handle network timeout errors', async () => {
        mockGet.mockRejectedValue(new Error('Network timeout'));

        const result = await readLinksFromSheet('MainSheet');

        expect(result).toEqual([]);
        expect(logFail).toHaveBeenCalledWith(
          '❌ อ่านชีตล้มเหลว: AcceptLinks',
          'Network timeout',
          true
        );
      });

      it('should handle authentication errors', async () => {
        mockGet.mockRejectedValue(new Error('Authentication failed'));

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toEqual([]);
        expect(logFail).toHaveBeenCalledWith(
          '❌ อ่านชีตล้มเหลว: NOTOUCH',
          'Authentication failed',
          true
        );
      });

      it('should handle permission errors', async () => {
        mockGet.mockRejectedValue(new Error('Insufficient permissions'));

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toEqual([]);
        expect(logFail).toHaveBeenCalledWith(
          '❌ อ่านชีตล้มเหลว: NOTOUCH',
          'Insufficient permissions',
          true
        );
      });
    });

    describe('Edge Cases', () => {
      it('should handle rows with different lengths', async () => {
        // Create a row with link at correct column Q (index 16)
        const longRow = Array(17).fill('');
        longRow[2] = '2026-01-23 10:30:00';  // Column C timestamp
        longRow[16] = 'https://example.com/task/1';  // Column Q link

        const mockRows = [
          // Short row - no link at column Q
          ['', '', '2026-01-23 10:00:00'],
          // Long row with link at correct position (column Q)
          longRow,
          // Row with link at correct position
          [
            '', '', '2026-01-23 11:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/2'
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        // Only rows with both link and timestamp should be included
        expect(result).toHaveLength(2);
      });

      it('should handle special characters in URLs', async () => {
        const mockRows = [
          [
            '', '', '2026-01-23 10:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task?id=123&type=test&name=تست'
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toHaveLength(1);
        expect(result[0].url).toBe('https://example.com/task?id=123&type=test&name=تست');
      });

      it('should handle URLs with unicode characters', async () => {
        const mockRows = [
          [
            '', '', '2026-01-23 10:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/งาน-ทดสอบ-🚀'
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toHaveLength(1);
        expect(result[0].url).toBe('https://example.com/task/งาน-ทดสอบ-🚀');
      });

      it('should handle different timestamp formats', async () => {
        const mockRows = [
          [
            '', '', '2026-01-23 10:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/1'
          ],
          [
            '', '', '23/01/2026 10:30', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/2'
          ],
          [
            '', '', '2026-01-23T10:45:30Z', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/3'
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toHaveLength(3);
        expect(result[0].timestamp).toBe('2026-01-23 10:00:00');
        expect(result[1].timestamp).toBe('23/01/2026 10:30');
        expect(result[2].timestamp).toBe('2026-01-23T10:45:30Z');
      });

      it('should trim whitespace from both link and timestamp', async () => {
        const mockRows = [
          [
            '', '', '  2026-01-23 10:00:00  ', '', '', '', '', '', '', '', '', '', '', '', '', '',
            '  https://example.com/task/1  '
          ],
          [
            '', '', '\t2026-01-23 11:00:00\t', '', '', '', '', '', '', '', '', '', '', '', '', '',
            '\thttps://example.com/task/2\n'
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toHaveLength(2);
        expect(result[0].url).toBe('https://example.com/task/1');
        expect(result[0].timestamp).toBe('2026-01-23 10:00:00');
        expect(result[1].url).toBe('https://example.com/task/2');
        expect(result[1].timestamp).toBe('2026-01-23 11:00:00');
      });

      it('should handle very large datasets', async () => {
        // Create 1000 rows of data
        const mockRows = Array.from({ length: 1000 }, (_, i) => {
          const row = Array(17).fill('');
          row[2] = `2026-01-23 10:${String(i % 60).padStart(2, '0')}:00`;
          row[16] = `https://example.com/task/${i + 1}`;
          return row;
        });

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        expect(result).toHaveLength(1000);
        expect(result[0].rowNumber).toBe(2);
        expect(result[999].rowNumber).toBe(1001);
      });

      it('should handle rows where link column is beyond row length', async () => {
        const mockRows = [
          // Row is too short to contain column Q (index 16)
          ['', '', '2026-01-23 10:00:00', 'some', 'data'],
          // Row has enough columns
          [
            '', '', '2026-01-23 11:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/1'
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('DATASheet');

        // First row should be skipped (undefined at index 16)
        expect(result).toHaveLength(1);
        expect(result[0].url).toBe('https://example.com/task/1');
        expect(result[0].rowNumber).toBe(3);
      });
    });

    describe('Column Index Mapping', () => {
      it('should correctly map column letters to indices', async () => {
        // Test with different column configurations
        const testCases = [
          { letter: 'A', expectedIndex: 0, timestampCol: 'B', timestampIndex: 1 },
          { letter: 'B', expectedIndex: 1, timestampCol: 'A', timestampIndex: 0 },
          { letter: 'C', expectedIndex: 2, timestampCol: 'A', timestampIndex: 0 },
          { letter: 'Q', expectedIndex: 16, timestampCol: 'A', timestampIndex: 0 },
          { letter: 'Z', expectedIndex: 25, timestampCol: 'A', timestampIndex: 0 }
        ];

        for (const { letter, expectedIndex, timestampCol, timestampIndex } of testCases) {
          const { jobLinks } = require('../../Config/configs');
          jobLinks.TestColumn = {
            sheetId: 'test-sheet-id',
            tabName: 'TestTab',
            LinksColumn: letter,
            ReceviedDate: timestampCol,
            StartRow: 2
          };

          // Create row with timestamp and link at different columns
          const row = Array(26).fill('');
          row[timestampIndex] = '2026-01-23 10:00:00';  // Timestamp
          row[expectedIndex] = `https://example.com/task/${letter}`;  // Link at tested column

          const mockRows = [row];

          mockGet.mockResolvedValue({
            data: { values: mockRows }
          });

          const result = await readLinksFromSheet('TestColumn');

          expect(result).toHaveLength(1);
          expect(result[0].url).toBe(`https://example.com/task/${letter}`);
          expect(result[0].timestamp).toBe('2026-01-23 10:00:00');

          delete jobLinks.TestColumn;
        }
      });

      it('should handle lowercase column letters', async () => {
        const { jobLinks } = require('../../Config/configs');
        jobLinks.LowercaseTest = {
          sheetId: 'test-sheet-id',
          tabName: 'TestTab',
          LinksColumn: 'q',  // lowercase
          ReceviedDate: 'c',  // lowercase
          StartRow: 2
        };

        const mockRows = [
          [
            '', '', '2026-01-23 10:00:00', '', '', '', '', '', '', '', '', '', '', '', '', '',
            'https://example.com/task/lowercase'
          ]
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        const result = await readLinksFromSheet('LowercaseTest');

        expect(result).toHaveLength(1);
        expect(result[0].url).toBe('https://example.com/task/lowercase');
        expect(result[0].timestamp).toBe('2026-01-23 10:00:00');

        delete jobLinks.LowercaseTest;
      });
    });

    describe('Row Number Calculation', () => {
      it('should calculate correct row numbers with different StartRow values', async () => {
        const mockRows = [
          ['https://example.com/task/1', '2026-01-23 10:00:00'],
          ['https://example.com/task/2', '2026-01-23 11:00:00'],
          ['https://example.com/task/3', '2026-01-23 12:00:00']
        ];

        mockGet.mockResolvedValue({
          data: { values: mockRows }
        });

        // MainSheet has StartRow: 5
        const result = await readLinksFromSheet('MainSheet');

        expect(result).toHaveLength(3);
        expect(result[0].rowNumber).toBe(5);  // StartRow + 0
        expect(result[1].rowNumber).toBe(6);  // StartRow + 1
        expect(result[2].rowNumber).toBe(7);  // StartRow + 2
      });
    });
  });
});
