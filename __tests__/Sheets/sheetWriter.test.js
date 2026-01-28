/**
 * Tests for Sheets/sheetWriter.js
 */

jest.mock('googleapis', () => ({
  google: {
    sheets: jest.fn(() => ({
      spreadsheets: {
        values: {
          append: jest.fn()
        }
      }
    }))
  }
}));

jest.mock('../../Google/auth', () => ({
  auth: 'mock-auth'
}));

jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logFail: jest.fn()
}));

jest.mock('../../Config/configs', () => ({
  DEFAULT_SHEET_KEY: 'TestSheet',
  jobLinks: {
    TestSheet: {
      sheetId: 'test-sheet-id',
      tabName: 'Sheet1',
      LinksOrderColumn: 'A',
      TimestampColumn: 'D'
    },
    AnotherSheet: {
      sheetId: 'another-sheet-id',
      tabName: 'Data',
      LinksOrderColumn: 'B',
      TimestampColumn: 'E'
    }
  }
}));

const { google } = require('googleapis');
const { logSuccess, logFail } = require('../../Logs/logger');
const { appendStatusToMainSheet } = require('../../Sheets/sheetWriter');

describe('Sheets/sheetWriter.js', () => {
  let mockAppend;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppend = jest.fn().mockResolvedValue({ data: {} });
    google.sheets.mockReturnValue({
      spreadsheets: {
        values: {
          append: mockAppend
        }
      }
    });
  });

  describe('appendStatusToMainSheet', () => {
    describe('Successful Operations', () => {
      it('should append status to default sheet', async () => {
        await appendStatusToMainSheet({
          url: 'https://example.com/task/123',
          status: 'Accepted',
          reason: 'Auto accepted'
        });

        expect(mockAppend).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A:D',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [[
              'https://example.com/task/123',
              'Accepted',
              'Auto accepted',
              expect.any(String)
            ]]
          }
        });
        expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('TestSheet'));
      });

      it('should append status to specified sheet', async () => {
        await appendStatusToMainSheet({
          url: 'https://example.com/task/456',
          status: 'Rejected',
          reason: 'Over capacity',
          sheetKey: 'AnotherSheet'
        });

        expect(mockAppend).toHaveBeenCalledWith({
          spreadsheetId: 'another-sheet-id',
          range: 'Data!B:E',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [[
              'https://example.com/task/456',
              'Rejected',
              'Over capacity',
              expect.any(String)
            ]]
          }
        });
        expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('AnotherSheet'));
      });

      it('should use provided timestamp', async () => {
        const customTimestamp = '2026-01-23 10:30:00';

        await appendStatusToMainSheet({
          url: 'https://example.com/task/789',
          status: 'Pending',
          reason: 'Waiting',
          timestamp: customTimestamp
        });

        expect(mockAppend).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: {
              values: [[
                'https://example.com/task/789',
                'Pending',
                'Waiting',
                customTimestamp
              ]]
            }
          })
        );
      });

      it('should generate timestamp when not provided', async () => {
        await appendStatusToMainSheet({
          url: 'https://example.com/task/101',
          status: 'Processed',
          reason: 'Done'
        });

        const callArgs = mockAppend.mock.calls[0][0];
        const timestamp = callArgs.requestBody.values[0][3];

        // Should be in YYYY-MM-DD HH:mm:ss format
        expect(timestamp).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
      });
    });

    describe('Error Handling', () => {
      it('should throw error when config not found', async () => {
        await expect(
          appendStatusToMainSheet({
            url: 'https://example.com/task',
            status: 'Test',
            reason: 'Test',
            sheetKey: 'NonExistentSheet'
          })
        ).rejects.toThrow('MainSheet config not found');
      });

      it('should log error when API call fails', async () => {
        mockAppend.mockRejectedValue(new Error('API Error'));

        await appendStatusToMainSheet({
          url: 'https://example.com/task',
          status: 'Test',
          reason: 'Test'
        });

        expect(logFail).toHaveBeenCalledWith(
          expect.stringContaining('Append failed'),
          true
        );
      });

      it('should handle network errors', async () => {
        mockAppend.mockRejectedValue(new Error('Network timeout'));

        await appendStatusToMainSheet({
          url: 'https://example.com/task',
          status: 'Test',
          reason: 'Test'
        });

        expect(logFail).toHaveBeenCalledWith(
          expect.stringContaining('Network timeout'),
          true
        );
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty strings', async () => {
        await appendStatusToMainSheet({
          url: '',
          status: '',
          reason: ''
        });

        expect(mockAppend).toHaveBeenCalled();
        expect(logSuccess).toHaveBeenCalled();
      });

      it('should handle special characters in values', async () => {
        await appendStatusToMainSheet({
          url: 'https://example.com/task?id=123&type=test',
          status: 'Status with "quotes"',
          reason: "Reason with 'single quotes'"
        });

        expect(mockAppend).toHaveBeenCalled();
        expect(logSuccess).toHaveBeenCalled();
      });

      it('should handle unicode characters', async () => {
        await appendStatusToMainSheet({
          url: 'https://example.com/task',
          status: 'สถานะ',
          reason: 'เหตุผล 🚀'
        });

        expect(mockAppend).toHaveBeenCalled();
        expect(logSuccess).toHaveBeenCalled();
      });
    });
  });
});
