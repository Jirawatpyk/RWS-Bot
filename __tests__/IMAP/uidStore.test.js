const fs = require('fs');
const path = require('path');
const {
  getUidStorePath,
  loadLastSeenUidFromFile,
  saveLastSeenUid
} = require('../../IMAP/uidStore');
const { logInfo, logFail } = require('../../Logs/logger');

// Mock dependencies
jest.mock('fs');
jest.mock('../../Logs/logger');

describe('IMAP/uidStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUidStorePath', () => {
    it('should generate correct path for simple mailbox name', () => {
      const result = getUidStorePath('Inbox');
      expect(result).toBe(path.join(__dirname, '../../IMAP', 'uidStore_Inbox.json'));
    });

    it('should replace special characters with underscores', () => {
      const result = getUidStorePath('Symfonie/Order');
      expect(result).toBe(path.join(__dirname, '../../IMAP', 'uidStore_Symfonie_Order.json'));
    });

    it('should replace multiple special characters', () => {
      const result = getUidStorePath('Test@Mailbox#123!');
      expect(result).toBe(path.join(__dirname, '../../IMAP', 'uidStore_Test_Mailbox_123_.json'));
    });

    it('should handle spaces in mailbox name', () => {
      const result = getUidStorePath('My Mailbox Name');
      expect(result).toBe(path.join(__dirname, '../../IMAP', 'uidStore_My_Mailbox_Name.json'));
    });

    it('should handle mailbox name with dots and dashes', () => {
      const result = getUidStorePath('test.box-name');
      expect(result).toBe(path.join(__dirname, '../../IMAP', 'uidStore_test_box_name.json'));
    });

    it('should handle empty string mailbox name', () => {
      const result = getUidStorePath('');
      expect(result).toBe(path.join(__dirname, '../../IMAP', 'uidStore_.json'));
    });
  });

  describe('loadLastSeenUidFromFile', () => {
    it('should load UID from file when file exists with valid data', () => {
      const mailboxName = 'Symfonie/Order';
      const expectedUid = 12345;

      fs.readFileSync.mockReturnValue(JSON.stringify({ lastSeenUid: expectedUid }));

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(expectedUid);
      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.join(__dirname, '../../IMAP', 'uidStore_Symfonie_Order.json'),
        'utf8'
      );
      expect(logInfo).toHaveBeenCalledWith(
        `📥 Loaded UID from file (${mailboxName}): ${expectedUid}`
      );
    });

    it('should return 0 when file exists but lastSeenUid is missing', () => {
      const mailboxName = 'TestMailbox';

      fs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        `📥 Loaded UID from file (${mailboxName}): 0`
      );
    });

    it('should return 0 when file exists but lastSeenUid is null', () => {
      const mailboxName = 'TestMailbox';

      fs.readFileSync.mockReturnValue(JSON.stringify({ lastSeenUid: null }));

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        `📥 Loaded UID from file (${mailboxName}): 0`
      );
    });

    it('should return 0 when file does not exist', () => {
      const mailboxName = 'NonExistentMailbox';

      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        `📥 UID file not found for ${mailboxName}. Starting fresh.`
      );
    });

    it('should return 0 when file contains invalid JSON', () => {
      const mailboxName = 'CorruptedMailbox';

      fs.readFileSync.mockReturnValue('{ invalid json }');

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        `📥 UID file not found for ${mailboxName}. Starting fresh.`
      );
    });

    it('should return 0 when file is empty', () => {
      const mailboxName = 'EmptyMailbox';

      fs.readFileSync.mockReturnValue('');

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        `📥 UID file not found for ${mailboxName}. Starting fresh.`
      );
    });

    it('should handle UID value of 0', () => {
      const mailboxName = 'ZeroUidMailbox';

      fs.readFileSync.mockReturnValue(JSON.stringify({ lastSeenUid: 0 }));

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(0);
      expect(logInfo).toHaveBeenCalledWith(
        `📥 Loaded UID from file (${mailboxName}): 0`
      );
    });

    it('should handle very large UID values', () => {
      const mailboxName = 'LargeUidMailbox';
      const largeUid = 999999999;

      fs.readFileSync.mockReturnValue(JSON.stringify({ lastSeenUid: largeUid }));

      const result = loadLastSeenUidFromFile(mailboxName);

      expect(result).toBe(largeUid);
      expect(logInfo).toHaveBeenCalledWith(
        `📥 Loaded UID from file (${mailboxName}): ${largeUid}`
      );
    });
  });

  describe('saveLastSeenUid', () => {
    it('should save UID to file atomically using temp file', () => {
      const mailboxName = 'Symfonie/Order';
      const uid = 12345;
      const expectedPath = path.join(__dirname, '../../IMAP', 'uidStore_Symfonie_Order.json');
      const expectedTempPath = expectedPath + '.tmp';

      saveLastSeenUid(mailboxName, uid);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedTempPath,
        JSON.stringify({ lastSeenUid: uid })
      );
      expect(fs.renameSync).toHaveBeenCalledWith(expectedTempPath, expectedPath);
      expect(logInfo).toHaveBeenCalledWith(
        `💾 Saved UID (${mailboxName}): ${uid}`
      );
      expect(logFail).not.toHaveBeenCalled();
    });

    it('should save UID value of 0', () => {
      const mailboxName = 'TestMailbox';
      const uid = 0;
      const expectedPath = path.join(__dirname, '../../IMAP', 'uidStore_TestMailbox.json');
      const expectedTempPath = expectedPath + '.tmp';

      saveLastSeenUid(mailboxName, uid);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedTempPath,
        JSON.stringify({ lastSeenUid: 0 })
      );
      expect(fs.renameSync).toHaveBeenCalledWith(expectedTempPath, expectedPath);
      expect(logInfo).toHaveBeenCalledWith(
        `💾 Saved UID (${mailboxName}): 0`
      );
    });

    it('should save very large UID values', () => {
      const mailboxName = 'LargeUidMailbox';
      const largeUid = 999999999;
      const expectedPath = path.join(__dirname, '../../IMAP', 'uidStore_LargeUidMailbox.json');
      const expectedTempPath = expectedPath + '.tmp';

      saveLastSeenUid(mailboxName, largeUid);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedTempPath,
        JSON.stringify({ lastSeenUid: largeUid })
      );
      expect(fs.renameSync).toHaveBeenCalledWith(expectedTempPath, expectedPath);
      expect(logInfo).toHaveBeenCalledWith(
        `💾 Saved UID (${mailboxName}): ${largeUid}`
      );
    });

    it('should handle writeFileSync error gracefully', () => {
      const mailboxName = 'FailMailbox';
      const uid = 12345;
      const writeError = new Error('EACCES: permission denied');

      fs.writeFileSync.mockImplementation(() => {
        throw writeError;
      });

      saveLastSeenUid(mailboxName, uid);

      expect(logFail).toHaveBeenCalledWith(
        `❌ Failed to save UID for ${mailboxName}:`,
        writeError
      );
      expect(logInfo).not.toHaveBeenCalled();
      expect(fs.renameSync).not.toHaveBeenCalled();
    });

    it('should handle renameSync error gracefully', () => {
      const mailboxName = 'RenameFailMailbox';
      const uid = 12345;
      const renameError = new Error('EPERM: operation not permitted');

      fs.writeFileSync.mockImplementation(() => {}); // Success
      fs.renameSync.mockImplementation(() => {
        throw renameError;
      });

      saveLastSeenUid(mailboxName, uid);

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(logFail).toHaveBeenCalledWith(
        `❌ Failed to save UID for ${mailboxName}:`,
        renameError
      );
      expect(logInfo).not.toHaveBeenCalled();
    });

    it('should handle disk full error', () => {
      const mailboxName = 'DiskFullMailbox';
      const uid = 12345;
      const diskFullError = new Error('ENOSPC: no space left on device');

      fs.writeFileSync.mockImplementation(() => {
        throw diskFullError;
      });

      saveLastSeenUid(mailboxName, uid);

      expect(logFail).toHaveBeenCalledWith(
        `❌ Failed to save UID for ${mailboxName}:`,
        diskFullError
      );
    });

    it('should handle special characters in mailbox name during save', () => {
      const mailboxName = 'Test@Mailbox#123!';
      const uid = 54321;
      const expectedPath = path.join(__dirname, '../../IMAP', 'uidStore_Test_Mailbox_123_.json');
      const expectedTempPath = expectedPath + '.tmp';

      saveLastSeenUid(mailboxName, uid);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedTempPath,
        JSON.stringify({ lastSeenUid: uid })
      );
      expect(fs.renameSync).toHaveBeenCalledWith(expectedTempPath, expectedPath);
    });

    it('should handle negative UID values', () => {
      const mailboxName = 'NegativeUidMailbox';
      const uid = -1;
      const expectedPath = path.join(__dirname, '../../IMAP', 'uidStore_NegativeUidMailbox.json');
      const expectedTempPath = expectedPath + '.tmp';

      saveLastSeenUid(mailboxName, uid);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedTempPath,
        JSON.stringify({ lastSeenUid: -1 })
      );
      expect(fs.renameSync).toHaveBeenCalledWith(expectedTempPath, expectedPath);
      expect(logInfo).toHaveBeenCalledWith(
        `💾 Saved UID (${mailboxName}): -1`
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should load and save UID for the same mailbox consistently', () => {
      const mailboxName = 'IntegrationTest';
      const firstUid = 100;
      const secondUid = 200;

      // Save first UID
      saveLastSeenUid(mailboxName, firstUid);

      // Mock load to return the saved UID
      fs.readFileSync.mockReturnValue(JSON.stringify({ lastSeenUid: firstUid }));
      const loadedUid = loadLastSeenUidFromFile(mailboxName);

      expect(loadedUid).toBe(firstUid);

      // Save new UID
      jest.clearAllMocks();
      saveLastSeenUid(mailboxName, secondUid);

      // Mock load to return the new UID
      fs.readFileSync.mockReturnValue(JSON.stringify({ lastSeenUid: secondUid }));
      const newLoadedUid = loadLastSeenUidFromFile(mailboxName);

      expect(newLoadedUid).toBe(secondUid);
    });

    it('should handle concurrent mailbox operations independently', () => {
      const mailbox1 = 'Mailbox1';
      const mailbox2 = 'Mailbox2';
      const uid1 = 111;
      const uid2 = 222;

      // Save to both mailboxes
      saveLastSeenUid(mailbox1, uid1);
      saveLastSeenUid(mailbox2, uid2);

      // Verify both saves were called with correct paths
      const expectedPath1 = path.join(__dirname, '../../IMAP', 'uidStore_Mailbox1.json');
      const expectedPath2 = path.join(__dirname, '../../IMAP', 'uidStore_Mailbox2.json');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedPath1 + '.tmp',
        JSON.stringify({ lastSeenUid: uid1 })
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedPath2 + '.tmp',
        JSON.stringify({ lastSeenUid: uid2 })
      );
    });

    it('should recover from corrupted file by returning 0', () => {
      const mailboxName = 'RecoveryTest';

      // First attempt: corrupted file
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Corrupted file');
      });

      const uid1 = loadLastSeenUidFromFile(mailboxName);
      expect(uid1).toBe(0);

      // Save new UID
      const newUid = 300;
      saveLastSeenUid(mailboxName, newUid);

      // Second attempt: file is now valid
      fs.readFileSync.mockReturnValue(JSON.stringify({ lastSeenUid: newUid }));
      const uid2 = loadLastSeenUidFromFile(mailboxName);

      expect(uid2).toBe(newUid);
    });
  });
});
