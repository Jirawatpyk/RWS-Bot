/**
 * Tests for IMAP/i18nParser.js - I18nEmailParser
 *
 * Coverage targets:
 * - detectLanguage(): header, HTML lang, heuristic, fallback
 * - getPatternsForLanguage(): all supported + unknown language
 * - registerLanguage(): add new language, merge with English base
 * - getSupportedLanguages(): returns registered languages
 * - Language-specific regex patterns: en, th, ja, de
 */

const { I18nEmailParser } = require('../../IMAP/i18nParser');

describe('IMAP/i18nParser.js', () => {
  let parser;

  beforeEach(() => {
    parser = new I18nEmailParser();
  });

  // ===== detectLanguage() =====
  describe('detectLanguage', () => {
    describe('from Content-Language header', () => {
      it('should detect "th" from contentLanguage header', () => {
        const result = parser.detectLanguage('Hello world', { contentLanguage: 'th' });
        expect(result).toBe('th');
      });

      it('should detect "ja" from content-language header (kebab-case key)', () => {
        const result = parser.detectLanguage('Hello', { 'content-language': 'ja' });
        expect(result).toBe('ja');
      });

      it('should handle locale format like "de-DE"', () => {
        const result = parser.detectLanguage('Hello', { contentLanguage: 'de-DE' });
        expect(result).toBe('de');
      });

      it('should handle locale with underscore like "th_TH"', () => {
        const result = parser.detectLanguage('Hello', { contentLanguage: 'th_TH' });
        expect(result).toBe('th');
      });

      it('should ignore unsupported language in header and continue detection', () => {
        const result = parser.detectLanguage('Hello plain text', { contentLanguage: 'fr' });
        // fr is not registered, so header detection returns null
        // No Thai/Japanese/German chars, so heuristic returns null
        // Fallback to 'en'
        expect(result).toBe('en');
      });

      it('should ignore empty header', () => {
        const result = parser.detectLanguage('Hello', { contentLanguage: '' });
        expect(result).toBe('en');
      });
    });

    describe('from HTML lang attribute', () => {
      it('should detect language from <html lang="th">', () => {
        const html = '<html lang="th"><body>Content</body></html>';
        const result = parser.detectLanguage(html);
        expect(result).toBe('th');
      });

      it('should detect language from <html lang="ja-JP">', () => {
        const html = '<html lang="ja-JP"><head></head><body>Content</body></html>';
        const result = parser.detectLanguage(html);
        expect(result).toBe('ja');
      });

      it('should handle single quotes in lang attribute', () => {
        const html = "<html lang='de'><body>Content</body></html>";
        const result = parser.detectLanguage(html);
        expect(result).toBe('de');
      });

      it('should ignore unsupported HTML lang and continue detection', () => {
        const html = '<html lang="fr"><body>Plain english content</body></html>';
        const result = parser.detectLanguage(html);
        expect(result).toBe('en');
      });
    });

    describe('from character heuristics', () => {
      it('should detect Thai from Thai characters', () => {
        const content = 'สถานะ: ใหม่ จำนวนคำ: 1500';
        const result = parser.detectLanguage(content);
        expect(result).toBe('th');
      });

      it('should detect Japanese from CJK characters', () => {
        const content = 'ステータス: 新規 ワード数: 2000';
        const result = parser.detectLanguage(content);
        expect(result).toBe('ja');
      });

      it('should detect German from umlaut characters', () => {
        const content = 'Wortanzahl: 3000 Abgabetermin: 25.01.2026 Gepr\u00FCft';
        const result = parser.detectLanguage(content);
        expect(result).toBe('de');
      });

      it('should fallback to English when no special characters found', () => {
        const content = 'Status: New amountWords: 1000 plannedEndDate: 2026-01-25';
        const result = parser.detectLanguage(content);
        expect(result).toBe('en');
      });
    });

    describe('priority order', () => {
      it('should prefer header over HTML lang', () => {
        const html = '<html lang="de"><body>Content</body></html>';
        const result = parser.detectLanguage(html, { contentLanguage: 'th' });
        expect(result).toBe('th');
      });

      it('should prefer HTML lang over heuristics', () => {
        // Content has Thai chars but HTML declares 'de'
        const html = '<html lang="de"><body>สวัสดี</body></html>';
        const result = parser.detectLanguage(html);
        expect(result).toBe('de');
      });

      it('should prefer heuristics over English fallback', () => {
        const content = 'Some English text with ภาษาไทย mixed in';
        const result = parser.detectLanguage(content);
        expect(result).toBe('th');
      });
    });

    describe('edge cases', () => {
      it('should handle null content', () => {
        const result = parser.detectLanguage(null);
        expect(result).toBe('en');
      });

      it('should handle undefined content', () => {
        const result = parser.detectLanguage(undefined);
        expect(result).toBe('en');
      });

      it('should handle empty string content', () => {
        const result = parser.detectLanguage('');
        expect(result).toBe('en');
      });

      it('should handle no arguments', () => {
        const result = parser.detectLanguage();
        expect(result).toBe('en');
      });

      it('should handle non-string content', () => {
        const result = parser.detectLanguage(12345);
        expect(result).toBe('en');
      });
    });
  });

  // ===== getPatternsForLanguage() =====
  describe('getPatternsForLanguage', () => {
    it('should return English patterns for "en"', () => {
      const patterns = parser.getPatternsForLanguage('en');
      expect(patterns).toBeDefined();
      expect(patterns.status).toBeInstanceOf(RegExp);
      expect(patterns.amountWords).toBeInstanceOf(RegExp);
      expect(patterns.plannedEndDate).toBeInstanceOf(RegExp);
      expect(patterns.orderId).toBeInstanceOf(RegExp);
      expect(patterns.moraviaLinks).toBeInstanceOf(RegExp);
      expect(patterns.domLabels).toBeDefined();
    });

    it('should return Thai patterns for "th"', () => {
      const patterns = parser.getPatternsForLanguage('th');
      expect(patterns.domLabels.status).toBe('สถานะ');
      expect(patterns.domLabels.amounts).toBe('จำนวนคำ');
    });

    it('should return Japanese patterns for "ja"', () => {
      const patterns = parser.getPatternsForLanguage('ja');
      expect(patterns.domLabels.status).toBe('ステータス');
    });

    it('should return German patterns for "de"', () => {
      const patterns = parser.getPatternsForLanguage('de');
      expect(patterns.domLabels.amounts).toBe('Wortanzahl');
    });

    it('should fallback to English for unknown language', () => {
      const patterns = parser.getPatternsForLanguage('zz');
      const enPatterns = parser.getPatternsForLanguage('en');
      expect(patterns).toEqual(enPatterns);
    });

    it('should fallback to English for null', () => {
      const patterns = parser.getPatternsForLanguage(null);
      const enPatterns = parser.getPatternsForLanguage('en');
      expect(patterns).toEqual(enPatterns);
    });
  });

  // ===== registerLanguage() =====
  describe('registerLanguage', () => {
    it('should register a new language with custom patterns', () => {
      parser.registerLanguage('ko', {
        status: /상태\s*[:：]?\s*['"]?([^\s'"]+)['"]?/i,
        domLabels: {
          status: '상태',
          amounts: '단어 수',
          plannedEnd: '마감일',
          workflowName: '워크플로 이름'
        }
      });

      const patterns = parser.getPatternsForLanguage('ko');
      expect(patterns.status).toBeInstanceOf(RegExp);
      expect(patterns.domLabels.status).toBe('상태');
      // Should inherit English patterns for fields not provided
      expect(patterns.orderId).toBeInstanceOf(RegExp);
      expect(patterns.moraviaLinks).toBeInstanceOf(RegExp);
    });

    it('should override existing language patterns', () => {
      const originalStatus = parser.getPatternsForLanguage('th').status;
      const newStatusRegex = /สถานะงาน\s*[:：]?\s*(.+)/i;

      parser.registerLanguage('th', {
        status: newStatusRegex
      });

      const updated = parser.getPatternsForLanguage('th');
      expect(updated.status).toBe(newStatusRegex);
      expect(updated.status).not.toEqual(originalStatus);
    });
  });

  // ===== getSupportedLanguages() =====
  describe('getSupportedLanguages', () => {
    it('should return default supported languages', () => {
      const langs = parser.getSupportedLanguages();
      expect(langs).toContain('en');
      expect(langs).toContain('th');
      expect(langs).toContain('ja');
      expect(langs).toContain('de');
      expect(langs).toHaveLength(4);
    });

    it('should include newly registered language', () => {
      parser.registerLanguage('ko', { status: /test/i });
      const langs = parser.getSupportedLanguages();
      expect(langs).toContain('ko');
      expect(langs).toHaveLength(5);
    });
  });

  // ===== Language-specific regex pattern matching =====
  describe('language-specific regex patterns', () => {
    describe('English patterns', () => {
      it('should match English status text', () => {
        const patterns = parser.getPatternsForLanguage('en');
        const match = 'Status: New'.match(patterns.status);
        expect(match).not.toBeNull();
        expect(match[1].trim()).toBe('New');
      });

      it('should match English amountWords', () => {
        const patterns = parser.getPatternsForLanguage('en');
        const match = 'amountWords: 1500'.match(patterns.amountWords);
        expect(match).not.toBeNull();
        expect(match[1]).toBe('1500');
      });

      it('should match English plannedEndDate', () => {
        const patterns = parser.getPatternsForLanguage('en');
        const match = 'plannedEndDate: 25.01.2026 10:30 AM'.match(patterns.plannedEndDate);
        expect(match).not.toBeNull();
      });
    });

    describe('Thai patterns', () => {
      it('should match Thai status text', () => {
        const patterns = parser.getPatternsForLanguage('th');
        const match = 'สถานะ: ใหม่'.match(patterns.status);
        expect(match).not.toBeNull();
        expect(match[1].trim()).toBe('ใหม่');
      });

      it('should match Thai amountWords', () => {
        const patterns = parser.getPatternsForLanguage('th');
        const match = 'จำนวนคำ: 2,500'.match(patterns.amountWords);
        expect(match).not.toBeNull();
        expect(match[1]).toBe('2,500');
      });

      it('should match Thai plannedEndDate', () => {
        const patterns = parser.getPatternsForLanguage('th');
        const match = 'วันส่งมอบ: 25.01.2026 10:30 AM'.match(patterns.plannedEndDate);
        expect(match).not.toBeNull();
      });
    });

    describe('Japanese patterns', () => {
      it('should match Japanese status text', () => {
        const patterns = parser.getPatternsForLanguage('ja');
        const match = 'ステータス: 新規'.match(patterns.status);
        expect(match).not.toBeNull();
      });

      it('should match Japanese amountWords', () => {
        const patterns = parser.getPatternsForLanguage('ja');
        const match = 'ワード数: 3000'.match(patterns.amountWords);
        expect(match).not.toBeNull();
        expect(match[1]).toBe('3000');
      });
    });

    describe('German patterns', () => {
      it('should match German status text', () => {
        const patterns = parser.getPatternsForLanguage('de');
        const match = 'Status: Neu'.match(patterns.status);
        expect(match).not.toBeNull();
        expect(match[1].trim()).toBe('Neu');
      });

      it('should match German amountWords', () => {
        const patterns = parser.getPatternsForLanguage('de');
        const match = 'Wortanzahl: 4,500'.match(patterns.amountWords);
        expect(match).not.toBeNull();
        expect(match[1]).toBe('4,500');
      });

      it('should match German plannedEndDate', () => {
        const patterns = parser.getPatternsForLanguage('de');
        const match = 'Abgabetermin: 25.01.2026 10:30 AM'.match(patterns.plannedEndDate);
        expect(match).not.toBeNull();
      });
    });

    describe('orderId and moraviaLinks (language-independent)', () => {
      it('should match orderId identically across all languages', () => {
        const langs = ['en', 'th', 'ja', 'de'];
        for (const lang of langs) {
          const patterns = parser.getPatternsForLanguage(lang);
          const match = 'Task [#12345] assigned'.match(patterns.orderId);
          expect(match).not.toBeNull();
          expect(match[1]).toBe('12345');
        }
      });

      it('should match moraviaLinks identically across all languages', () => {
        const url = 'https://projects.moravia.com/Task/12345/detail/notification?command=Accept';
        const langs = ['en', 'th', 'ja', 'de'];
        for (const lang of langs) {
          const patterns = parser.getPatternsForLanguage(lang);
          const matches = url.match(patterns.moraviaLinks);
          expect(matches).not.toBeNull();
          expect(matches).toHaveLength(1);
        }
      });
    });
  });
});
