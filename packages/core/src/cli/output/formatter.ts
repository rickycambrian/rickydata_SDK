import Table from 'cli-table3';

export type OutputFormat = 'table' | 'json';

export interface ColumnDef {
  header: string;
  key: string;
  width?: number;
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatTable(data: Record<string, unknown>[], columns: ColumnDef[]): string {
  if (data.length === 0) return '(no items)';

  const head = columns.map((c) => c.header);
  const hasWidths = columns.some((c) => c.width !== undefined);

  const tableOpts: ConstructorParameters<typeof Table>[0] = {
    head,
    style: { head: ['cyan'] },
  };
  if (hasWidths) {
    tableOpts.colWidths = columns.map((c) => c.width ?? 15);
  }

  const table = new Table(tableOpts);

  for (const row of data) {
    table.push(columns.map((c) => String(row[c.key] ?? '')));
  }

  return table.toString();
}

export function formatOutput(
  data: Record<string, unknown>[],
  columns: ColumnDef[],
  format: OutputFormat = 'table',
): string {
  if (format === 'json') return formatJson(data);
  return formatTable(data, columns);
}

export function formatKeyValue(data: Record<string, unknown>): string {
  const table = new Table({
    style: { head: ['cyan'] },
  });

  for (const [key, value] of Object.entries(data)) {
    let display: string;
    if (value === null || value === undefined) {
      display = '';
    } else if (typeof value === 'object') {
      display = JSON.stringify(value);
    } else {
      display = String(value);
    }
    table.push({ [key]: display });
  }

  return table.toString();
}
