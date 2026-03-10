import { describe, it, expect } from 'vitest';
import { formatJson, formatTable, formatOutput, formatKeyValue } from '../../src/cli/output/formatter.js';

describe('formatter', () => {
  describe('formatJson', () => {
    it('pretty-prints JSON', () => {
      const result = formatJson({ key: 'value', num: 42 });
      expect(result).toContain('"key": "value"');
      expect(result).toContain('"num": 42');
    });

    it('handles arrays', () => {
      const result = formatJson([1, 2, 3]);
      expect(result).toContain('1');
      expect(result).toContain('2');
    });

    it('handles null', () => {
      expect(formatJson(null)).toBe('null');
    });
  });

  describe('formatTable', () => {
    const columns = [
      { header: 'ID', key: 'id' },
      { header: 'Name', key: 'name' },
    ];

    it('returns (no items) for empty data', () => {
      expect(formatTable([], columns)).toBe('(no items)');
    });

    it('includes column headers', () => {
      const result = formatTable([{ id: '1', name: 'Agent A' }], columns);
      expect(result).toContain('ID');
      expect(result).toContain('Name');
    });

    it('includes row values', () => {
      const result = formatTable([{ id: 'abc', name: 'Test' }], columns);
      expect(result).toContain('abc');
      expect(result).toContain('Test');
    });

    it('handles missing keys gracefully', () => {
      const result = formatTable([{ id: '1' }], columns);
      expect(result).toContain('1');
    });

    it('handles multiple rows', () => {
      const data = [
        { id: '1', name: 'Alpha' },
        { id: '2', name: 'Beta' },
      ];
      const result = formatTable(data, columns);
      expect(result).toContain('Alpha');
      expect(result).toContain('Beta');
    });
  });

  describe('formatOutput', () => {
    const columns = [{ header: 'Key', key: 'key' }, { header: 'Val', key: 'val' }];
    const data = [{ key: 'foo', val: 'bar' }];

    it('dispatches to table format by default', () => {
      const result = formatOutput(data, columns);
      expect(result).toContain('Key');
      expect(result).toContain('foo');
    });

    it('dispatches to json format when specified', () => {
      const result = formatOutput(data, columns, 'json');
      expect(result).toContain('"key": "foo"');
    });
  });

  describe('formatKeyValue', () => {
    it('renders key-value pairs', () => {
      const result = formatKeyValue({ url: 'https://example.com', status: 'active' });
      expect(result).toContain('url');
      expect(result).toContain('https://example.com');
      expect(result).toContain('status');
      expect(result).toContain('active');
    });

    it('handles empty object', () => {
      const result = formatKeyValue({});
      expect(typeof result).toBe('string');
    });
  });
});
