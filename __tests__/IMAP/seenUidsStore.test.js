const fs = require('fs');
const path = require('path');
const { loadSeenUids, saveSeenUids } = require('../../IMAP/seenUidsStore');
const { logInfo, logFail } = require('../../Logs/logger');

// Mock dependencies
jest.mock('fs');
jest.mock('../../Logs/logger');

describe('seenUidsStore', () => {
  const TEST_MAILBOX = 'Test_Mailbox';
  const EXPECTED_FILENAME = 'seenUids_Test_Mailbox.json';
  let expectedPath;

  beforeAll(() => {
    // Calculate expected path based on actual __dirname of seenUidsStore.js
    expectedPath = path.join(
      path.dirname(require.resolve('../../IMAP/seenUidsStore')),
      EXPECTED_FILENAME
    );
  });

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('loadSeenUids', () => {
    it('should load UIDs from existing file and return as Set', () => {
      // Arrange
      const mockUids = [1001, 1002, 1003, 1004];
      const mockFileContent = JSON.stringify(mockUids);
      fs.readFileSync.mockReturnValue(mockFileContent);

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert
      expect(fs.readFileSync).toHaveBeenCalledWith(expectedPath, 'utf8');
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(4);
      expect([...result]).toEqual(expect.arrayContaining(mockUids));
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining(`Loaded seen UIDs for ${TEST_MAILBOX}: 4 items`)
      );
    });

    it('should return empty Set when file does not exist', () => {
      // Arrange
      fs.readFileSync.mockImplementation(() => {
        const error = new Error('ENOENT: no such file or directory');
        error.code = 'ENOENT';
        throw error;
      });

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining(`No seen UID file for ${TEST_MAILBOX}. Starting fresh.`)
      );
    });

    it('should return empty Set when file contains invalid JSON', () => {
      // Arrange
      fs.readFileSync.mockReturnValue('{ invalid json content');

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('Starting fresh')
      );
    });

    it('should return empty Set when file is empty', () => {
      // Arrange
      fs.readFileSync.mockReturnValue('');

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('should handle empty array in file', () => {
      // Arrange
      fs.readFileSync.mockReturnValue('[]');

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('0 items')
      );
    });

    it('should handle large number of UIDs', () => {
      // Arrange
      const largeUidArray = Array.from({ length: 5000 }, (_, i) => i + 1000);
      fs.readFileSync.mockReturnValue(JSON.stringify(largeUidArray));

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert
      expect(result.size).toBe(5000);
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('5000 items')
      );
    });

    it('should sanitize mailbox name with special characters', () => {
      // Arrange
      const specialMailbox = 'Test/Mailbox@2024!';
      const expectedSanitized = 'seenUids_Test_Mailbox_2024_.json';
      const expectedSpecialPath = path.join(
        path.dirname(require.resolve('../../IMAP/seenUidsStore')),
        expectedSanitized
      );
      fs.readFileSync.mockReturnValue('[]');

      // Act
      loadSeenUids(specialMailbox);

      // Assert
      expect(fs.readFileSync).toHaveBeenCalledWith(expectedSpecialPath, 'utf8');
    });

    it('should handle UIDs with duplicate values (Set behavior)', () => {
      // Arrange
      const duplicateUids = [1001, 1002, 1002, 1003, 1003, 1003];
      fs.readFileSync.mockReturnValue(JSON.stringify(duplicateUids));

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert
      expect(result.size).toBe(3); // Set removes duplicates
      expect([...result]).toEqual([1001, 1002, 1003]);
    });
  });

  describe('saveSeenUids', () => {
    it('should save Set as JSON array to file', () => {
      // Arrange
      const testSet = new Set([2001, 2002, 2003]);
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      saveSeenUids(TEST_MAILBOX, testSet);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedPath,
        JSON.stringify([2001, 2002, 2003])
      );
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining(`Saved seen UIDs for ${TEST_MAILBOX}: 3 items`)
      );
    });

    it('should save empty Set as empty array', () => {
      // Arrange
      const emptySet = new Set();
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      saveSeenUids(TEST_MAILBOX, emptySet);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedPath,
        '[]'
      );
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('0 items')
      );
    });

    it('should handle write errors gracefully', () => {
      // Arrange
      const testSet = new Set([3001, 3002]);
      const writeError = new Error('EACCES: permission denied');
      fs.writeFileSync.mockImplementation(() => {
        throw writeError;
      });

      // Act
      saveSeenUids(TEST_MAILBOX, testSet);

      // Assert
      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to save seen UIDs for ${TEST_MAILBOX}`),
        writeError
      );
    });

    it('should save large Set without errors', () => {
      // Arrange
      const largeSet = new Set(Array.from({ length: 2000 }, (_, i) => i + 5000));
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      saveSeenUids(TEST_MAILBOX, largeSet);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalled();
      const savedData = fs.writeFileSync.mock.calls[0][1];
      const parsedData = JSON.parse(savedData);
      expect(parsedData.length).toBe(2000);
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('2000 items')
      );
    });

    it('should sanitize mailbox name when saving', () => {
      // Arrange
      const specialMailbox = 'Order@#$%Mailbox!';
      const expectedSanitized = 'seenUids_Order____Mailbox_.json';
      const expectedSpecialPath = path.join(
        path.dirname(require.resolve('../../IMAP/seenUidsStore')),
        expectedSanitized
      );
      const testSet = new Set([4001]);
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      saveSeenUids(specialMailbox, testSet);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedSpecialPath,
        expect.any(String)
      );
    });

    it('should handle Set with string UIDs', () => {
      // Arrange
      const stringSet = new Set(['uid-1', 'uid-2', 'uid-3']);
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      saveSeenUids(TEST_MAILBOX, stringSet);

      // Assert
      const savedData = fs.writeFileSync.mock.calls[0][1];
      expect(savedData).toBe(JSON.stringify(['uid-1', 'uid-2', 'uid-3']));
    });

    it('should handle disk full error', () => {
      // Arrange
      const testSet = new Set([6001, 6002]);
      const diskFullError = new Error('ENOSPC: no space left on device');
      diskFullError.code = 'ENOSPC';
      fs.writeFileSync.mockImplementation(() => {
        throw diskFullError;
      });

      // Act
      saveSeenUids(TEST_MAILBOX, testSet);

      // Assert
      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save seen UIDs'),
        diskFullError
      );
    });
  });

  describe('integration scenarios', () => {
    it('should successfully load and save UIDs in sequence', () => {
      // Arrange - First load
      const initialUids = [100, 200, 300];
      fs.readFileSync.mockReturnValue(JSON.stringify(initialUids));

      // Act - Load
      const loadedSet = loadSeenUids(TEST_MAILBOX);

      // Arrange - Add new UIDs
      loadedSet.add(400);
      loadedSet.add(500);
      fs.writeFileSync.mockReturnValue(undefined);

      // Act - Save
      saveSeenUids(TEST_MAILBOX, loadedSet);

      // Assert
      expect(loadedSet.size).toBe(5);
      const savedData = fs.writeFileSync.mock.calls[0][1];
      const savedArray = JSON.parse(savedData);
      expect(savedArray).toEqual(expect.arrayContaining([100, 200, 300, 400, 500]));
    });

    it('should handle concurrent mailbox operations', () => {
      // Arrange
      const mailbox1 = 'Inbox';
      const mailbox2 = 'Sent';
      fs.readFileSync.mockReturnValue('[]');
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      const set1 = loadSeenUids(mailbox1);
      const set2 = loadSeenUids(mailbox2);
      set1.add(1000);
      set2.add(2000);
      saveSeenUids(mailbox1, set1);
      saveSeenUids(mailbox2, set2);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync).toHaveBeenCalledTimes(2);

      // Verify different paths were used
      const calls = fs.writeFileSync.mock.calls;
      expect(calls[0][0]).toContain('seenUids_Inbox.json');
      expect(calls[1][0]).toContain('seenUids_Sent.json');
    });

    it('should maintain data integrity after failed save', () => {
      // Arrange
      const testSet = new Set([7001, 7002, 7003]);
      fs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('Write failed');
      });

      // Act - First save fails
      saveSeenUids(TEST_MAILBOX, testSet);

      // Arrange - Second save succeeds
      fs.writeFileSync.mockImplementationOnce(() => undefined);

      // Act - Retry save
      saveSeenUids(TEST_MAILBOX, testSet);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      expect(logFail).toHaveBeenCalledTimes(1);
      expect(logInfo).toHaveBeenCalledTimes(1);

      // Verify Set was not modified
      expect(testSet.size).toBe(3);
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should throw error for null or undefined mailbox name', () => {
      // The current implementation does not handle null/undefined
      // and will throw TypeError when trying to call .replace()
      fs.readFileSync.mockReturnValue('[]');

      expect(() => loadSeenUids(null)).toThrow(TypeError);
      expect(() => loadSeenUids(undefined)).toThrow(TypeError);
    });

    it('should handle very long mailbox names', () => {
      // Arrange
      const longMailbox = 'A'.repeat(255); // Maximum typical filename length
      fs.readFileSync.mockReturnValue('[]');

      // Act & Assert
      expect(() => loadSeenUids(longMailbox)).not.toThrow();
    });

    it('should handle UIDs with various data types in array', () => {
      // Arrange - Mixed types (though this shouldn't happen in practice)
      const mixedUids = [1, '2', 3, '4'];
      fs.readFileSync.mockReturnValue(JSON.stringify(mixedUids));

      // Act
      const result = loadSeenUids(TEST_MAILBOX);

      // Assert - Set will handle mixed types
      expect(result.size).toBe(4);
      expect(result.has(1)).toBe(true);
      expect(result.has('2')).toBe(true);
    });

    it('should handle readonly filesystem error', () => {
      // Arrange
      const testSet = new Set([8001]);
      const readonlyError = new Error('EROFS: read-only file system');
      readonlyError.code = 'EROFS';
      fs.writeFileSync.mockImplementation(() => {
        throw readonlyError;
      });

      // Act
      saveSeenUids(TEST_MAILBOX, testSet);

      // Assert
      expect(logFail).toHaveBeenCalledWith(
        expect.any(String),
        readonlyError
      );
    });

    it('should preserve UID order when converting Set to array', () => {
      // Arrange
      const orderedUids = [100, 200, 300, 400, 500];
      const testSet = new Set(orderedUids);
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      saveSeenUids(TEST_MAILBOX, testSet);

      // Assert
      const savedData = fs.writeFileSync.mock.calls[0][1];
      const savedArray = JSON.parse(savedData);

      // Sets maintain insertion order in JavaScript
      expect(savedArray).toEqual(orderedUids);
    });
  });

  describe('potential bugs in source code', () => {
    it('should note that limitedUids variable is created but not used (line 29)', () => {
      // This test documents a bug in the source code:
      // Line 29 creates limitedUids = uidArray.slice(-1000)
      // Line 30 saves [...seenSet] instead of limitedUids
      // This means the 1000-item limit is NOT actually enforced

      // Arrange - Create a Set with more than 1000 items
      const largeSet = new Set(Array.from({ length: 1500 }, (_, i) => i + 1));
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      saveSeenUids(TEST_MAILBOX, largeSet);

      // Assert - Currently saves all 1500 items (bug behavior)
      const savedData = fs.writeFileSync.mock.calls[0][1];
      const savedArray = JSON.parse(savedData);

      // BUG: This should be 1000, but it's actually 1500
      expect(savedArray.length).toBe(1500);

      // If the bug were fixed, it should be:
      // expect(savedArray.length).toBe(1000);
      // expect(savedArray).toEqual(expect.arrayContaining([501, 502, ..., 1500]));
    });
  });
});
