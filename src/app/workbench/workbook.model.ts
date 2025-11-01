export type WorkbookId = string;

export interface Workbook {
  id: WorkbookId;
  title: string;
  sheets: WorkbookSheet[];
  activeSheetId: string;
  locale: string;
  updatedAt: string;
  showToolbar?: boolean;
  showFormulaBar?: boolean;
  showSheetTabs?: boolean;
}

export interface WorkbookSheet {
  id: string;
  name: string;
  order: number;
  visible: boolean;
  celldata: WorkbookCell[];
  config?: SheetConfig;
  updatedAt?: string;
}

export interface WorkbookCell {
  r: number;
  c: number;
  v?: CellValue;
  format?: CellFormat;
}

export interface CellValue {
  v?: string | number | boolean | null;
  m?: string;
  f?: string;
  ct?: { t: string };
  error?: string;
  [key: string]: any;
}

export type NumberFormat = 'plain' | 'number' | 'currency' | 'percent';

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  numberFormat?: NumberFormat;
}

export interface SheetConfig {
  rowCount?: number;
  columnCount?: number;
}

export interface WorkbookSelection {
  sheetId: string;
  rowRange: [number, number];
  colRange: [number, number];
  active: { row: number; column: number };
}
