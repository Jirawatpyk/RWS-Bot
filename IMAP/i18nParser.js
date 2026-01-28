/**
 * I18nEmailParser - Multi-Language Email Parser
 *
 * Detects email language and provides language-specific regex patterns
 * for extracting task data (status, word count, deadline, order ID, Moravia links).
 *
 * Supported languages: English (en), Thai (th), Japanese (ja), German (de)
 * Extensible via registerLanguage() for future additions.
 *
 * Usage:
 *   const parser = new I18nEmailParser();
 *   const lang = parser.detectLanguage(htmlContent, headers);
 *   const patterns = parser.getPatternsForLanguage(lang);
 */

class I18nEmailParser {
  constructor() {
    /**
     * Language-specific regex patterns for email field extraction.
     * Each language must define: status, amountWords, plannedEndDate, orderId, moraviaLinks.
     *
     * Notes:
     * - orderId and moraviaLinks are language-independent (URLs/IDs don't translate)
     * - status regex must handle the localized label (e.g., "Status", "สถานะ", "ステータス")
     */
    this.languagePatterns = {
      en: {
        status: /Status\s*[:：]?\s*['"]?([A-Za-z ]+)['"]?/i,
        amountWords: /amountWords\s*[:：]?\s*['"]?([0-9.,]+)/i,
        plannedEndDate: /plannedEndDate\s*[:：]?\s*['"]?([0-9./:\sAPMapm]+)['"]?/i,
        orderId: /\[#(\d+)\]/,
        moraviaLinks: /https:\/\/projects\.moravia\.com\/Task\/[^\s<>"']*\/detail\/notification\?command=Accept/g,
        // DOM label selectors for cheerio extraction (td:contains("Label"))
        domLabels: {
          status: 'Status',
          amounts: 'Amounts',
          plannedEnd: 'Planned end',
          workflowName: 'Workflow name'
        }
      },
      th: {
        status: /สถานะ\s*[:：]?\s*['"]?([ก-๛A-Za-z ]+)['"]?/i,
        amountWords: /จำนวนคำ\s*[:：]?\s*['"]?([0-9.,]+)/i,
        plannedEndDate: /วันส่งมอบ\s*[:：]?\s*['"]?([0-9./:\sAPMapm]+)['"]?/i,
        orderId: /\[#(\d+)\]/,
        moraviaLinks: /https:\/\/projects\.moravia\.com\/Task\/[^\s<>"']*\/detail\/notification\?command=Accept/g,
        domLabels: {
          status: 'สถานะ',
          amounts: 'จำนวนคำ',
          plannedEnd: 'วันส่งมอบ',
          workflowName: 'ชื่อเวิร์กโฟลว์'
        }
      },
      ja: {
        status: /ステータス\s*[:：]?\s*['"]?([^\s'"]+)['"]?/i,
        amountWords: /ワード数\s*[:：]?\s*['"]?([0-9.,]+)/i,
        plannedEndDate: /期限\s*[:：]?\s*['"]?([0-9./:\sAPMapm]+)['"]?/i,
        orderId: /\[#(\d+)\]/,
        moraviaLinks: /https:\/\/projects\.moravia\.com\/Task\/[^\s<>"']*\/detail\/notification\?command=Accept/g,
        domLabels: {
          status: 'ステータス',
          amounts: 'ワード数',
          plannedEnd: '期限',
          workflowName: 'ワークフロー名'
        }
      },
      de: {
        status: /Status\s*[:：]?\s*['"]?([A-Za-z\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF ]+)['"]?/i,
        amountWords: /Wortanzahl\s*[:：]?\s*['"]?([0-9.,]+)/i,
        plannedEndDate: /Abgabetermin\s*[:：]?\s*['"]?([0-9./:\sAPMapm]+)['"]?/i,
        orderId: /\[#(\d+)\]/,
        moraviaLinks: /https:\/\/projects\.moravia\.com\/Task\/[^\s<>"']*\/detail\/notification\?command=Accept/g,
        domLabels: {
          status: 'Status',
          amounts: 'Wortanzahl',
          plannedEnd: 'Abgabetermin',
          workflowName: 'Workflow-Name'
        }
      }
    };

    // Character range patterns for heuristic language detection
    // Ordered by specificity: most unique character ranges first
    this._heuristicRules = [
      { lang: 'th', pattern: /[\u0E00-\u0E7F]/ },   // Thai characters
      { lang: 'ja', pattern: /[\u3000-\u9FFF]/ },    // CJK + Hiragana + Katakana
      { lang: 'de', pattern: /[\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF]/ }  // German umlauts
    ];
  }

  /**
   * Auto-detect language from email content and headers.
   * Detection priority:
   *   1. Content-Language header (most reliable)
   *   2. HTML lang attribute
   *   3. Character heuristics (Thai > Japanese > German > English)
   *   4. Fallback: 'en'
   *
   * @param {string} content - HTML or plain text email body
   * @param {Object} [headers={}] - Email headers (e.g., { contentLanguage: 'th' })
   * @returns {string} ISO 639-1 language code (e.g., 'en', 'th', 'ja', 'de')
   */
  detectLanguage(content, headers = {}) {
    // 1. Check Content-Language header
    const headerLang = this._detectFromHeader(headers);
    if (headerLang) return headerLang;

    // 2. Check HTML lang attribute
    const htmlLang = this._detectFromHtmlLang(content);
    if (htmlLang) return htmlLang;

    // 3. Character-based heuristic detection
    const heuristicLang = this._detectFromHeuristics(content);
    if (heuristicLang) return heuristicLang;

    // 4. Fallback to English
    return 'en';
  }

  /**
   * Get regex patterns and DOM labels for a specific language.
   * Returns English patterns as fallback if language is not registered.
   *
   * @param {string} lang - ISO 639-1 language code
   * @returns {Object} Pattern set for the language
   */
  getPatternsForLanguage(lang) {
    return this.languagePatterns[lang] || this.languagePatterns.en;
  }

  /**
   * Register a new language or override existing patterns.
   * Merges with English patterns as base, so you only need to provide
   * the fields that differ from English.
   *
   * @param {string} langCode - ISO 639-1 language code
   * @param {Object} patterns - Partial or full pattern set
   */
  registerLanguage(langCode, patterns) {
    this.languagePatterns[langCode] = {
      ...this.languagePatterns.en,
      ...patterns
    };
  }

  /**
   * Get list of all registered language codes.
   * @returns {string[]}
   */
  getSupportedLanguages() {
    return Object.keys(this.languagePatterns);
  }

  // ========== Private Detection Methods ==========

  /**
   * Extract language from Content-Language header.
   * Handles formats like 'th', 'th-TH', 'en-US'.
   * @private
   */
  _detectFromHeader(headers) {
    const raw = headers.contentLanguage || headers['content-language'] || '';
    if (!raw) return null;

    const lang = raw.trim().split(/[-_]/)[0].toLowerCase();
    return this.languagePatterns[lang] ? lang : null;
  }

  /**
   * Extract language from HTML lang attribute.
   * Matches <html lang="xx"> or <html lang="xx-XX">.
   * @private
   */
  _detectFromHtmlLang(content) {
    if (!content || typeof content !== 'string') return null;

    const match = content.match(/<html[^>]*\slang=["']?([a-zA-Z]{2})(?:[-_][a-zA-Z]+)?["']?/i);
    if (!match) return null;

    const lang = match[1].toLowerCase();
    return this.languagePatterns[lang] ? lang : null;
  }

  /**
   * Detect language by checking for characteristic Unicode ranges.
   * Tests rules in order of specificity (Thai first, then Japanese, then German).
   * @private
   */
  _detectFromHeuristics(content) {
    if (!content || typeof content !== 'string') return null;

    for (const rule of this._heuristicRules) {
      if (rule.pattern.test(content)) {
        return rule.lang;
      }
    }

    return null;
  }
}

module.exports = { I18nEmailParser };
