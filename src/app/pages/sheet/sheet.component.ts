import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SheetWorkbenchComponent } from '../../workbench/sheet-workbench.component';
import {
  Workbook,
  WorkbookSelection,
  WorkbookSheet,
  WorkbookCell,
  CellFormat,
  NumberFormat
} from '../../workbench/workbook.model';

declare global {
  interface Window {
    XLSX?: any;
  }
}
import { SheetsService, SheetDoc, defaultGrid } from '../../sheets.service';
import { Subscription, fromEvent } from 'rxjs';

type MenuAction =
  | 'new'
  | 'open'
  | 'rename'
  | 'copy'
  | 'download-xlsx'
  | 'download-csv'
  | 'settings'
  | 'print'
  | 'share'
  | 'history';

@Component({
  standalone: true,
  selector: 'app-sheet',
  templateUrl: './sheet.component.html',
  styleUrls: ['./sheet.component.css'],
  imports: [CommonModule, FormsModule, RouterLink, SheetWorkbenchComponent]
})
export class SheetPageComponent implements OnInit, OnDestroy {
  @ViewChild(SheetWorkbenchComponent) workbench?: SheetWorkbenchComponent;

  readonly sheetsService = inject(SheetsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  sheetDoc: WritableSignal<SheetDoc | null> = signal(null);
  workbook: WritableSignal<Workbook | null> = signal(null);
  loading = signal(true);
  saving = signal(false);
  saveError: WritableSignal<string | null> = signal(null);
  formulaBuffer = signal('');
  formulaError = signal<string | null>(null);
  activeFormat = signal<CellFormat>({});
  contextMenus = [
    { name: 'File', actions: ['new', 'open', 'rename', 'copy', 'download-xlsx', 'download-csv', 'print'] as MenuAction[] },
    { name: 'Edit', actions: [] as MenuAction[] },
    { name: 'Data', actions: ['settings'] as MenuAction[] },
    { name: 'Collaborate', actions: ['share', 'history'] as MenuAction[] }
  ];
  private readonly actionLabels: Record<MenuAction, string> = {
    new: 'New',
    open: 'Open',
    rename: 'Rename',
    copy: 'Make a copy',
    'download-xlsx': 'Download (.xlsx)',
    'download-csv': 'Download (.csv)',
    settings: 'Workbook settings',
    print: 'Print',
    share: 'Share & permissions',
    history: 'Version history'
  };

  activeSelection = signal<WorkbookSelection | null>(null);
  private autoSaveHandle: any;
  private visibilitySub?: Subscription;
  private xlsxLoader?: Promise<any>;

  ngOnInit(): void {
    this.bootstrap();
    this.visibilitySub = fromEvent(document, 'visibilitychange').subscribe(() => {
      if (!document.hidden) {
        this.flushPendingSave();
      }
    });
  }

  labelFor(action: MenuAction): string {
    return this.actionLabels[action] ?? action;
  }

  onFormulaInput(value: string): void {
    this.formulaBuffer.set(value);
  }

  onFormulaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onFormulaCommit();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      this.onFormulaCommit();
    }
  }

  onFormulaCommit(): void {
    const selection = this.activeSelection();
    if (!selection) {
      return;
    }
    this.workbench?.applyExternalValue(this.formulaBuffer());
  }

  trackSheet = (_: number, sheet: WorkbookSheet) => sheet.id;

  ngOnDestroy(): void {
    if (this.autoSaveHandle) {
      clearTimeout(this.autoSaveHandle);
    }
    this.visibilitySub?.unsubscribe();
  }

  async onMenu(action: MenuAction) {
    switch (action) {
      case 'new':
        await this.createNewWorkbook();
        break;
      case 'open':
        await this.router.navigate(['/']);
        break;
      case 'rename':
        this.requestRename();
        break;
      case 'copy':
        await this.duplicateCurrent();
        break;
      case 'download-xlsx':
        await this.exportWorkbook('xlsx');
        break;
      case 'download-csv':
        await this.exportWorkbook('csv');
        break;
      case 'print':
        window.print();
        break;
      case 'share':
        // Placeholder for the upcoming collaboration dialog
        alert('Sharing UI coming soon');
        break;
      case 'history':
        alert('Version history coming soon');
        break;
      case 'settings':
        alert('Workbook settings coming soon');
        break;
    }
  }

  handleTitleInput(event: Event) {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input) {
      return;
    }
    this.onTitleChange(input.value);
  }

  async onTitleChange(title: string) {
    const doc = this.sheetDoc();
    if (!doc) {
      return;
    }
    doc.title = title;
    this.sheetDoc.set({ ...doc });
    this.queueSave();
  }

  handleWorkbookChange(workbook: Workbook) {
    this.workbook.set(workbook);
    const doc = this.sheetDoc();
    if (!doc) {
      return;
    }
    doc.data = workbook;
    doc.updatedAt = new Date().toISOString();
    this.sheetDoc.set({ ...doc });
    this.syncFormulaBuffer(workbook, this.activeSelection());
    this.queueSave();
  }

  handleSelectionChange(selection: WorkbookSelection) {
    this.activeSelection.set(selection);
    this.syncFormulaBuffer(this.workbook(), selection);
  }

  private syncFormulaBuffer(workbook?: Workbook | null, selection?: WorkbookSelection | null) {
    const sourceWorkbook = workbook ?? this.workbook();
    const active = selection ?? this.activeSelection();
    if (!sourceWorkbook || !active) {
      this.formulaBuffer.set('');
      this.formulaError.set(null);
      this.activeFormat.set({});
      return;
    }
    const sheet = sourceWorkbook.sheets.find(s => s.id === active.sheetId);
    if (!sheet) {
      this.formulaBuffer.set('');
      this.formulaError.set(null);
      this.activeFormat.set({});
      return;
    }
    const rowIndex = active.active?.row ?? active.rowRange[0];
    const colIndex = active.active?.column ?? active.colRange[0];
    const cell = sheet.celldata.find(item => item.r === rowIndex && item.c === colIndex);
    if (cell && cell.v && typeof cell.v === 'object' && typeof (cell.v as any).f === 'string') {
      this.formulaBuffer.set(`=${(cell.v as any).f}`);
    } else {
      const value = cell ? this.extractCellValue(cell.v) : '';
      this.formulaBuffer.set(value != null ? String(value) : '');
    }
    const errorMessage =
      cell && cell.v && typeof cell.v === 'object' && typeof (cell.v as any).error === 'string'
        ? (cell.v as any).error
        : null;
    this.formulaError.set(errorMessage);
    this.activeFormat.set(cell?.format ?? {});
  }

  private async bootstrap(): Promise<void> {
    this.loading.set(true);
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      const existing = await this.sheetsService.fetch(id);
      if (existing) {
        this.sheetDoc.set(existing);
        const workbook = this.toWorkbook(existing);
        this.workbook.set(workbook);
        this.syncFormulaBuffer(workbook, this.activeSelection());
      }
    }

    if (!this.sheetDoc()) {
      const created = await this.sheetsService.create({ title: 'Untitled workbook' });
      this.sheetDoc.set(created);
      const workbook = this.toWorkbook(created);
      this.workbook.set(workbook);
      this.syncFormulaBuffer(workbook, this.activeSelection());
      await this.router.navigate(['/sheet', created.id], { replaceUrl: true });
    }
    this.loading.set(false);
  }

  private toWorkbook(doc: SheetDoc): Workbook {
    const data = doc.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (Array.isArray((data as any).sheets)) {
        const raw = data as Workbook;
        const sheets = (raw.sheets ?? []).map((sheet, index) => this.normalizeSheet(sheet, index));
        const activeSheetId =
          raw.activeSheetId && sheets.some(sheet => sheet.id === raw.activeSheetId)
            ? raw.activeSheetId
            : sheets.find(sheet => sheet.visible)?.id ?? sheets[0]?.id ?? this.generateSheetId();
        return {
          id: raw.id ?? doc.id,
          title: raw.title ?? doc.title ?? 'Untitled workbook',
          locale: raw.locale ?? 'en',
          showToolbar: raw.showToolbar ?? true,
          showFormulaBar: raw.showFormulaBar ?? true,
          showSheetTabs: raw.showSheetTabs ?? true,
          sheets,
          activeSheetId,
          updatedAt: raw.updatedAt ?? doc.updatedAt ?? new Date().toISOString()
        };
      }
    }

    if (
      Array.isArray(data) &&
      data.length &&
      data.every(item => item && typeof item === 'object' && !Array.isArray(item))
    ) {
      const sheets = (data as any[]).map((sheet, index) => this.normalizeSheet(sheet, index));
      const activeSheetId = sheets.find(sheet => sheet.visible)?.id ?? sheets[0]?.id ?? this.generateSheetId();
      return {
        id: doc.id ?? `wb_${crypto.randomUUID()}`,
        title: doc.title ?? 'Untitled workbook',
        locale: 'en',
        showToolbar: true,
        showFormulaBar: true,
        showSheetTabs: true,
        sheets,
        activeSheetId,
        updatedAt: doc.updatedAt ?? new Date().toISOString()
      };
    }

    if (Array.isArray(data) && data.every(row => Array.isArray(row))) {
      return this.createWorkbookFromGrid(doc, data as string[][]);
    }

    return this.createWorkbookFromGrid(doc, defaultGrid(200, 26));
  }

  private createWorkbookFromGrid(doc: SheetDoc, grid: string[][]): Workbook {
    const sheetId = this.generateSheetId();
    const celldata: WorkbookSheet['celldata'] = [];
    grid.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value && value !== '') {
          celldata.push({
            r,
            c,
            v: {
              v: value,
              m: value,
              ct: { t: 's' }
            }
          });
        }
      });
    });
    return {
      id: doc.id ?? `wb_${crypto.randomUUID()}`,
      title: doc.title ?? 'Untitled workbook',
      locale: 'en',
      showToolbar: true,
      showFormulaBar: true,
      showSheetTabs: true,
      sheets: [
        {
          id: sheetId,
          name: 'Sheet1',
          order: 0,
          visible: true,
          celldata,
          config: {
            rowCount: grid.length,
            columnCount: grid[0]?.length ?? 0
          }
        }
      ],
      activeSheetId: sheetId,
      updatedAt: doc.updatedAt ?? new Date().toISOString()
    };
  }

  private normalizeSheet(input: Partial<WorkbookSheet> | any, index: number): WorkbookSheet {
    const id = input?.id ?? this.generateSheetId();
    const name = input?.name ?? `Sheet${index + 1}`;
    const order = typeof input?.order === 'number' ? input.order : index;
    const celldata = Array.isArray(input?.celldata) ? input.celldata : [];
    const visible =
      typeof input?.visible === 'boolean' ? input.visible : (input?.status ?? 1) !== 0;
    const config = input?.config ?? {};
    const normalizedConfig = {
      rowCount: typeof config?.rowCount === 'number' ? config.rowCount : undefined,
      columnCount: typeof config?.columnCount === 'number' ? config.columnCount : undefined
    };
    return {
      id,
      name,
      order,
      visible,
      celldata,
      config: normalizedConfig,
      updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : undefined
    };
  }

  private generateSheetId(): string {
    return `sheet_${crypto.randomUUID()}`;
  }

  private nextSheetName(workbook: Workbook): string {
    const base = 'Sheet';
    let index = workbook.sheets.length || 1;
    const existing = new Set(workbook.sheets.map(sheet => sheet.name));
    while (existing.has(`${base}${index}`)) {
      index += 1;
    }
    return `${base}${index}`;
  }

  private queueSave() {
    if (this.autoSaveHandle) {
      clearTimeout(this.autoSaveHandle);
    }
    this.autoSaveHandle = setTimeout(() => this.flushPendingSave(), 1500);
  }

  private async flushPendingSave() {
    if (this.saving()) {
      return;
    }
    const doc = this.sheetDoc();
    if (!doc) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const saved = await this.sheetsService.save(doc);
      if (saved) {
        this.sheetDoc.set(saved);
      }
    } catch (err: any) {
      this.saveError.set(err?.message ?? 'Failed to save workbook');
    } finally {
      this.saving.set(false);
    }
  }

  private async createNewWorkbook() {
    const created = await this.sheetsService.create({ title: 'Untitled workbook' });
    this.sheetDoc.set(created);
    const workbook = this.toWorkbook(created);
    this.workbook.set(workbook);
    this.syncFormulaBuffer(workbook, this.activeSelection());
    await this.router.navigate(['/sheet', created.id]);
  }

  private requestRename() {
    const title = prompt('Workbook title', this.sheetDoc()?.title ?? '');
    if (title !== null) {
      this.onTitleChange(title.trim());
    }
  }

  private async duplicateCurrent() {
    const doc = this.sheetDoc();
    if (!doc) {
      return;
    }
    const workbook = this.workbook();
    const copy = await this.sheetsService.create({
      title: `${doc.title ?? 'Untitled workbook'} (copy)`,
      data: workbook
    });
    this.sheetDoc.set(copy);
    const nextWorkbook = this.toWorkbook(copy);
    this.workbook.set(nextWorkbook);
    this.syncFormulaBuffer(nextWorkbook, this.activeSelection());
    await this.router.navigate(['/sheet', copy.id]);
  }

  addSheet(): void {
    const current = this.workbook();
    const doc = this.sheetDoc();
    if (!current || !doc) {
      return;
    }
    const sheetId = this.generateSheetId();
    const name = this.nextSheetName(current);
    const newSheet: WorkbookSheet = {
      id: sheetId,
      name,
      order: current.sheets.length,
      visible: true,
      celldata: [],
      config: {
        rowCount: 100,
        columnCount: 26
      }
    };
    const updated: Workbook = {
      ...current,
      sheets: [...current.sheets, newSheet],
      activeSheetId: sheetId,
      updatedAt: new Date().toISOString()
    };
    this.workbook.set(updated);
    doc.data = updated;
    doc.updatedAt = updated.updatedAt;
    this.sheetDoc.set({ ...doc });
    const selection: WorkbookSelection = {
      sheetId,
      rowRange: [0, 0],
      colRange: [0, 0],
      active: { row: 0, column: 0 }
    };
    this.activeSelection.set(selection);
    this.syncFormulaBuffer(updated, selection);
    this.queueSave();
  }

  setActiveSheet(sheetId: string): void {
    const current = this.workbook();
    const doc = this.sheetDoc();
    if (!current || !doc || sheetId === current.activeSheetId) {
      return;
    }
    if (!current.sheets.some(sheet => sheet.id === sheetId)) {
      return;
    }
    const updated: Workbook = {
      ...current,
      activeSheetId: sheetId,
      updatedAt: new Date().toISOString()
    };
    this.workbook.set(updated);
    doc.data = updated;
    doc.updatedAt = updated.updatedAt;
    this.sheetDoc.set({ ...doc });
    const selection: WorkbookSelection = {
      sheetId,
      rowRange: [0, 0],
      colRange: [0, 0],
      active: { row: 0, column: 0 }
    };
    this.activeSelection.set(selection);
    this.syncFormulaBuffer(updated, selection);
    this.queueSave();
  }

  renameSheet(sheetId: string): void {
    const current = this.workbook();
    const doc = this.sheetDoc();
    if (!current || !doc) {
      return;
    }
    const target = current.sheets.find(sheet => sheet.id === sheetId);
    if (!target) {
      return;
    }
    const nameInput = prompt('Sheet name', target.name);
    const name = nameInput?.trim();
    if (!name || name === target.name) {
      return;
    }
    const updatedSheets = current.sheets.map(sheet =>
      sheet.id === sheetId ? { ...sheet, name, updatedAt: new Date().toISOString() } : sheet
    );
    const updated: Workbook = {
      ...current,
      sheets: updatedSheets,
      updatedAt: new Date().toISOString()
    };
    this.workbook.set(updated);
    doc.data = updated;
    doc.updatedAt = updated.updatedAt;
    this.sheetDoc.set({ ...doc });
    this.queueSave();
  }

  toggleBold(): void {
    this.updateActiveCell((cell, row, column) => {
      const next: WorkbookCell = cell ? { ...cell } : { r: row, c: column };
      const format: CellFormat = { ...(next.format ?? {}) };
      format.bold = !format.bold;
      const sanitized = this.sanitizeFormat(format);
      if (sanitized) {
        next.format = sanitized;
      } else {
        delete next.format;
      }
      return !next.format && !this.cellHasValue(next) ? undefined : next;
    });
  }

  toggleItalic(): void {
    this.updateActiveCell((cell, row, column) => {
      const next: WorkbookCell = cell ? { ...cell } : { r: row, c: column };
      const format: CellFormat = { ...(next.format ?? {}) };
      format.italic = !format.italic;
      const sanitized = this.sanitizeFormat(format);
      if (sanitized) {
        next.format = sanitized;
      } else {
        delete next.format;
      }
      return !next.format && !this.cellHasValue(next) ? undefined : next;
    });
  }

  onNumberFormatChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select?.value as NumberFormat;
    this.setNumberFormat(value ?? 'plain');
  }

  setNumberFormat(format: NumberFormat): void {
    this.updateActiveCell((cell, row, column) => {
      const next: WorkbookCell = cell ? { ...cell } : { r: row, c: column };
      const currentFormat: CellFormat = { ...(next.format ?? {}) };
      if (format === 'plain') {
        delete currentFormat.numberFormat;
      } else {
        currentFormat.numberFormat = format;
      }
      const sanitized = this.sanitizeFormat(currentFormat);
      if (sanitized) {
        next.format = sanitized;
      } else {
        delete next.format;
      }
      return !next.format && !this.cellHasValue(next) ? undefined : next;
    });
  }

  private updateActiveCell(
    mutator: (cell: WorkbookCell | undefined, row: number, column: number) => WorkbookCell | undefined
  ): void {
    const workbook = this.workbook();
    const doc = this.sheetDoc();
    const selection = this.activeSelection();
    if (!workbook || !doc || !selection) {
      return;
    }
    const sheetId = selection.sheetId;
    const row = selection.rowRange[0];
    const column = selection.colRange[0];

    const updatedSheets = workbook.sheets.map(sheet => {
      if (sheet.id !== sheetId) {
        return sheet;
      }
      const cells = [...(sheet.celldata ?? [])];
      const index = cells.findIndex(cell => cell.r === row && cell.c === column);
      const currentCell = index >= 0 ? { ...cells[index] } : undefined;
      if (index >= 0) {
        cells.splice(index, 1);
      }
      const nextCell = mutator(currentCell, row, column);
      if (nextCell) {
        cells.push(nextCell);
        cells.sort((a, b) => (a.r - b.r) || (a.c - b.c));
      }
      return {
        ...sheet,
        celldata: cells,
        updatedAt: new Date().toISOString()
      };
    });

    const updatedWorkbook: Workbook = {
      ...workbook,
      sheets: updatedSheets,
      updatedAt: new Date().toISOString()
    };

    this.workbook.set(updatedWorkbook);
    doc.data = updatedWorkbook;
    doc.updatedAt = updatedWorkbook.updatedAt;
    this.sheetDoc.set({ ...doc });
    this.syncFormulaBuffer(updatedWorkbook, selection);
    this.queueSave();
  }

  private sanitizeFormat(source: CellFormat): CellFormat | undefined {
    const cleaned: CellFormat = {};
    if (source.bold) {
      cleaned.bold = true;
    }
    if (source.italic) {
      cleaned.italic = true;
    }
    if (source.numberFormat && source.numberFormat !== 'plain') {
      cleaned.numberFormat = source.numberFormat;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  private cellHasValue(cell: WorkbookCell | undefined): boolean {
    if (!cell) {
      return false;
    }
    const value = cell.v;
    if (value == null) {
      return false;
    }
    if (typeof value === 'object') {
      if (value.v != null && value.v !== '') {
        return true;
      }
      if (value.m != null && value.m !== '') {
        return true;
      }
      if (value.f != null && value.f !== '') {
        return true;
      }
      return false;
    }
    return value !== '';
  }

  private async exportWorkbook(format: 'xlsx' | 'csv') {
    const workbook = this.workbook();
    if (!workbook) {
      return;
    }
    if (format === 'csv') {
      this.exportCsv(workbook);
      return;
    }
    const XLSX = await this.ensureXlsxRuntime();
    if (!XLSX) {
      this.saveError.set('Unable to load XLSX exporter');
      return;
    }
    const wb = XLSX.utils.book_new();
    workbook.sheets.forEach(sheet => {
      const data: any[][] = [];
      sheet.celldata.forEach(cell => {
        const row = data[cell.r] ?? (data[cell.r] = []);
        row[cell.c] = this.extractCellValue(cell.v);
      });
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    });
    XLSX.writeFile(wb, `${workbook.title || 'Workbook'}.xlsx`);
  }

  private exportCsv(workbook: Workbook) {
    const active = workbook.sheets.find(s => s.id === workbook.activeSheetId) ?? workbook.sheets[0];
    if (!active) {
      return;
    }
    const maxRow = active.celldata.reduce((max, cell) => Math.max(max, cell.r), 0);
    const maxCol = active.celldata.reduce((max, cell) => Math.max(max, cell.c), 0);
    const grid: string[][] = Array.from({ length: maxRow + 1 }, () =>
      Array.from({ length: maxCol + 1 }, () => '')
    );
    active.celldata.forEach(cell => {
      grid[cell.r][cell.c] = this.extractCellValue(cell.v) ?? '';
    });
    const csv = grid
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${workbook.title || 'Workbook'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private extractCellValue(source: any): any {
    if (source == null) {
      return '';
    }
    if (typeof source === 'object') {
      if (Object.prototype.hasOwnProperty.call(source, 'v')) {
        return source.v;
      }
      if (Object.prototype.hasOwnProperty.call(source, 'm')) {
        return source.m;
      }
    }
    return source;
  }

  private async ensureXlsxRuntime(): Promise<any> {
    if (window.XLSX) {
      return window.XLSX;
    }
    if (!this.xlsxLoader) {
      this.xlsxLoader = new Promise((resolve, reject) => {
        const src = '/vendor/xlsx/xlsx.full.min.js';
        const selector = `script[data-xlsx-src="${src}"]`;
        const existing = document.querySelector(selector);
        const checkReady = () => {
          if (window.XLSX) {
            resolve(window.XLSX);
          } else {
            setTimeout(checkReady, 25);
          }
        };
        if (existing) {
          checkReady();
          return;
        }
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = src;
        script.async = true;
        script.dataset['xlsxSrc'] = src;
        script.onload = () => checkReady();
        script.onerror = () => {
          this.xlsxLoader = undefined;
          reject(new Error('Failed to load XLSX runtime'));
        };
        document.body.appendChild(script);
      });
    }
    return this.xlsxLoader;
  }
}
