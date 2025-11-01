import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Workbook, WorkbookCell, WorkbookSelection, WorkbookSheet, CellFormat, NumberFormat } from './workbook.model';

interface CellCoord {
  row: number;
  column: number;
}

interface EditorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface FillRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

interface BaseCellData {
  raw: any;
  display: string;
  format?: CellFormat;
  isNumeric: boolean;
  dateValue?: number;
}

interface FillPattern {
  kind: 'number' | 'date';
  start: number;
  step: number;
}

const FILL_HANDLE_SIZE = 8;

@Component({
  standalone: true,
  selector: 'app-sheet-workbench',
  templateUrl: './sheet-workbench.component.html',
  styleUrls: ['./sheet-workbench.component.css'],
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SheetWorkbenchComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) workbook!: Workbook;
  @Input() readOnly = false;

  @Output() workbookChange = new EventEmitter<Workbook>();
  @Output() selectionChange = new EventEmitter<WorkbookSelection>();

  @ViewChild('gridContainer', { static: true }) gridContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('gridBody', { static: true }) gridBody!: ElementRef<HTMLDivElement>;
  @ViewChild('cellEditor') cellEditor?: ElementRef<HTMLTextAreaElement>;

  readonly selectedCell = signal<CellCoord>({ row: 0, column: 0 });
  readonly editing = signal(false);
  readonly editorValue = signal('');
  readonly editorRect = signal<EditorRect>({ top: 0, left: 0, width: 0, height: 0 });
  readonly headerScrollLeft = signal(0);
  readonly selectionRange = signal<FillRange>({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
  readonly fillHandleRect = signal<EditorRect | null>(null);
  readonly fillPreview = signal<FillRange | null>(null);
  readonly fillPreviewRect = signal<EditorRect | null>(null);

  rowIndices: number[] = [];
  columnIndices: number[] = [];
  columnLabels: string[] = [];
  columnTemplate = '';

  private activeSheet?: WorkbookSheet;
  private cellMap = new Map<string, WorkbookCell>();
  private isFilling = false;
  private fillSourceRange?: FillRange;
  private selectionAnchor: CellCoord = { row: 0, column: 0 };
  private handleUpdateScheduled = false;
  private boundPointerMove = (event: PointerEvent) => this.onFillPointerMove(event);
  private boundPointerUp = (event: PointerEvent) => this.onFillPointerUp(event);

  ngOnInit(): void {
    this.applyWorkbook(this.workbook);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['workbook'] && this.workbook) {
      this.applyWorkbook(this.workbook);
    }
  }

  ngOnDestroy(): void {
    this.detachFillListeners();
  }

  get activeSheetId(): string | undefined {
    return this.activeSheet?.id;
  }

  onGridKeydown(event: KeyboardEvent): void {
    if (this.editing()) {
      return;
    }
    const key = event.key;
    switch (key) {
      case 'ArrowUp':
        this.moveSelection(-1, 0, event.shiftKey);
        event.preventDefault();
        break;
      case 'ArrowDown':
        this.moveSelection(1, 0, event.shiftKey);
        event.preventDefault();
        break;
      case 'ArrowLeft':
        this.moveSelection(0, -1, event.shiftKey);
        event.preventDefault();
        break;
      case 'ArrowRight':
        this.moveSelection(0, 1, event.shiftKey);
        event.preventDefault();
        break;
      case 'Tab':
        this.moveSelection(0, event.shiftKey ? -1 : 1);
        event.preventDefault();
        break;
      case 'Enter':
        this.beginEdit();
        event.preventDefault();
        break;
      case 'Backspace':
      case 'Delete':
        this.commitValue('');
        event.preventDefault();
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.beginEdit(event.key);
          event.preventDefault();
        }
        break;
    }
  }

  onGridScroll(): void {
    this.headerScrollLeft.set(this.gridBody.nativeElement.scrollLeft);
    this.scheduleHandleUpdate();
  }

  onCellPointer(row: number, column: number, event: MouseEvent): void {
    if (this.editing()) {
      this.commitEdit();
    }
    this.updateSelection({ row, column }, event.shiftKey);
    if (event.detail === 2) {
      this.beginEdit();
    }
    this.focusGrid();
  }

  beginEdit(initialText?: string): void {
    if (this.readOnly) {
      return;
    }
    const value = initialText ?? this.getCellDisplay(this.selectedCell().row, this.selectedCell().column);
    this.editing.set(true);
    this.editorValue.set(value);
    this.fillHandleRect.set(null);
    this.positionEditor();
    setTimeout(() => this.cellEditor?.nativeElement.focus());
  }

  commitEdit(): void {
    if (!this.editing()) {
      return;
    }
    this.commitValue(this.editorValue());
    this.editing.set(false);
    this.focusGrid();
    this.scheduleHandleUpdate();
  }

  onEditorKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      this.commitEdit();
      this.moveSelection(1, 0);
      event.preventDefault();
      return;
    }
    if (event.key === 'Tab') {
      this.commitEdit();
      this.moveSelection(0, event.shiftKey ? -1 : 1);
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      this.editing.set(false);
      event.preventDefault();
      this.focusGrid();
    }
  }

  onEditorInput(value: string): void {
    this.editorValue.set(value);
  }

  applyExternalValue(raw: string): void {
    this.commitValue(raw);
  }

  isCellSelected(row: number, column: number): boolean {
    const current = this.selectedCell();
    return current.row === row && current.column === column;
  }

  isRowSelected(row: number): boolean {
    const range = this.getSelectionRange();
    return row >= range.startRow && row <= range.endRow;
  }

  isColumnSelected(column: number): boolean {
    const range = this.getSelectionRange();
    return column >= range.startCol && column <= range.endCol;
  }

  trackByIndex(_: number, index: number): number {
    return index;
  }

  getCellDisplay(row: number, column: number): string {
    const cell = this.cellMap.get(this.cellKey(row, column));
    if (!cell) {
      return '';
    }
    let rawValue: any;
    let textValue: string | undefined;
    const payload = cell.v;
    if (payload && typeof payload === 'object') {
      if (payload.v != null) {
        rawValue = payload.v;
      }
      if (payload.m != null) {
        textValue = String(payload.m);
      }
    } else if (payload != null) {
      rawValue = payload;
    }

    const format = cell.format;
    if (format?.numberFormat && format.numberFormat !== 'plain') {
      const numeric =
        typeof rawValue === 'number'
          ? rawValue
          : Number(rawValue ?? textValue ?? NaN);
      if (!Number.isNaN(numeric)) {
        return this.formatNumber(numeric, format.numberFormat);
      }
    }

    if (textValue != null) {
      return textValue;
    }
    if (rawValue != null) {
      return String(rawValue);
    }
    return '';
  }

  cellError(row: number, column: number): string | null {
    const cell = this.cellMap.get(this.cellKey(row, column));
    if (!cell || !cell.v || typeof cell.v !== 'object') {
      return null;
    }
    const payload = cell.v as any;
    if (payload && typeof payload.error === 'string' && payload.error.length > 0) {
      return payload.error;
    }
    return null;
  }

  private getSelectionRange(): FillRange {
    return normalizeRange(this.selectionRange());
  }

  private isInSelectionRange(row: number, column: number): boolean {
    const range = this.getSelectionRange();
    return row >= range.startRow && row <= range.endRow && column >= range.startCol && column <= range.endCol;
  }

  private isInFillPreview(row: number, column: number): boolean {
    const range = this.fillPreview();
    if (!range) {
      return false;
    }
    const minRow = Math.min(range.startRow, range.endRow);
    const maxRow = Math.max(range.startRow, range.endRow);
    const minCol = Math.min(range.startCol, range.endCol);
    const maxCol = Math.max(range.startCol, range.endCol);
    if (row === range.startRow && column === range.startCol) {
      return false;
    }
    return row >= minRow && row <= maxRow && column >= minCol && column <= maxCol;
  }

  formatClasses(row: number, column: number): Record<string, boolean> {
    const format = this.getCellFormat(row, column);
    return {
      'sheet-grid__cell--bold': !!format?.bold,
      'sheet-grid__cell--italic': !!format?.italic,
      'sheet-grid__cell--range': this.isInSelectionRange(row, column) && !this.isCellSelected(row, column),
      'sheet-grid__cell--error': this.cellError(row, column) != null,
      'sheet-grid__cell--fill-preview': this.isInFillPreview(row, column)
    };
  }

  private applyWorkbook(workbook: Workbook): void {
    this.workbook = workbook;
    this.editing.set(false);
    this.editorValue.set('');
    this.resolveActiveSheet();
    this.rebuildSheetState();
    if (this.gridBody?.nativeElement) {
      this.gridBody.nativeElement.scrollTo({ top: 0, left: 0 });
      this.headerScrollLeft.set(0);
    }
    this.emitSelection();
    this.fillPreview.set(null);
    this.fillPreviewRect.set(null);
    this.scheduleHandleUpdate();
  }

  private resolveActiveSheet(): void {
    if (!this.workbook) {
      this.activeSheet = undefined;
      return;
    }
    const active =
      this.workbook.sheets.find(sheet => sheet.id === this.workbook.activeSheetId && sheet.visible !== false) ??
      this.workbook.sheets.find(sheet => sheet.visible !== false) ??
      this.workbook.sheets[0];
    this.activeSheet = active;
  }

  private rebuildSheetState(): void {
    this.cellMap.clear();
    if (!this.activeSheet) {
      this.rowIndices = [];
      this.columnIndices = [];
      this.columnLabels = [];
      this.columnTemplate = '';
      return;
    }

    let maxRow = 0;
    let maxColumn = 0;
    for (const cell of this.activeSheet.celldata ?? []) {
      this.cellMap.set(this.cellKey(cell.r, cell.c), cell);
      if (cell.r > maxRow) {
        maxRow = cell.r;
      }
      if (cell.c > maxColumn) {
        maxColumn = cell.c;
      }
    }

    const configuredRows = this.activeSheet.config?.rowCount ?? 0;
    const configuredColumns = this.activeSheet.config?.columnCount ?? 0;

    const totalRows = Math.max(DEFAULT_ROW_COUNT, configuredRows, maxRow + EXTRA_ROWS);
    const totalColumns = Math.max(DEFAULT_COLUMN_COUNT, configuredColumns, maxColumn + EXTRA_COLUMNS);

    this.rowIndices = Array.from({ length: totalRows }, (_, index) => index);
    this.columnIndices = Array.from({ length: totalColumns }, (_, index) => index);
    this.columnLabels = this.columnIndices.map(column => columnLabel(column));
    this.columnTemplate = `repeat(${totalColumns}, var(--sheet-cell-width))`;

    const maxRowIndex = totalRows - 1;
    const maxColumnIndex = totalColumns - 1;

    const previousSelected = this.selectedCell();
    const previousAnchor = this.selectionAnchor;
    const previousRange = this.selectionRange();

    const nextSelected: CellCoord = {
      row: clamp(previousSelected.row, 0, maxRowIndex),
      column: clamp(previousSelected.column, 0, maxColumnIndex)
    };

    const nextAnchor: CellCoord = {
      row: clamp(previousAnchor.row, 0, maxRowIndex),
      column: clamp(previousAnchor.column, 0, maxColumnIndex)
    };

    const nextRange = normalizeRange({
      startRow: clamp(previousRange.startRow, 0, maxRowIndex),
      endRow: clamp(previousRange.endRow, 0, maxRowIndex),
      startCol: clamp(previousRange.startCol, 0, maxColumnIndex),
      endCol: clamp(previousRange.endCol, 0, maxColumnIndex)
    });

    this.selectedCell.set(nextSelected);
    this.selectionAnchor = { ...nextAnchor };
    this.selectionRange.set(nextRange);
  }

  private emitSelection(): void {
    if (!this.activeSheet) {
      return;
    }
    const range = this.getSelectionRange();
    this.selectionChange.emit({
      sheetId: this.activeSheet.id,
      rowRange: [range.startRow, range.endRow],
      colRange: [range.startCol, range.endCol],
      active: { ...this.selectedCell() }
    });
  }

  private moveSelection(deltaRow: number, deltaColumn: number, extendSelection = false): void {
    if (!this.rowIndices.length || !this.columnIndices.length) {
      return;
    }
    const current = this.selectedCell();
    const nextRow = clamp(current.row + deltaRow, 0, this.rowIndices.length - 1);
    const nextColumn = clamp(current.column + deltaColumn, 0, this.columnIndices.length - 1);
    this.updateSelection({ row: nextRow, column: nextColumn }, extendSelection);
    this.ensureCellVisible(nextRow, nextColumn);
  }

  private updateSelection(coord: CellCoord, extend = false): void {
    if (!this.rowIndices.length || !this.columnIndices.length) {
      return;
    }
    const bounded: CellCoord = {
      row: clamp(coord.row, 0, this.rowIndices.length - 1),
      column: clamp(coord.column, 0, this.columnIndices.length - 1)
    };
    if (!extend) {
      this.selectionAnchor = { ...bounded };
    }
    const anchor = this.selectionAnchor;
    const range = extend
      ? { startRow: anchor.row, startCol: anchor.column, endRow: bounded.row, endCol: bounded.column }
      : { startRow: bounded.row, startCol: bounded.column, endRow: bounded.row, endCol: bounded.column };
    this.selectionRange.set(normalizeRange(range));
    this.selectedCell.set(bounded);
    this.emitSelection();
    this.fillPreview.set(null);
    this.fillPreviewRect.set(null);
    this.scheduleHandleUpdate();
  }

  private ensureCellVisible(row: number, column: number): void {
    const cellElement = this.findCellElement(row, column);
    if (!cellElement) {
      return;
    }
    cellElement.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    });
    this.scheduleHandleUpdate();
  }

  private commitValue(raw: string): void {
    if (!this.activeSheet || this.readOnly) {
      return;
    }
    const trimmed = raw ?? '';
    const { row, column } = this.selectedCell();
    const existing = this.cellMap.get(this.cellKey(row, column));
    const existingFormat = existing?.format ? { ...existing.format } : undefined;

    const nextSheets = this.workbook.sheets.map(sheet => {
      if (sheet.id !== this.activeSheet!.id) {
        return sheet;
      }
      const nextCells = (sheet.celldata ?? []).filter(cell => !(cell.r === row && cell.c === column));
      if (trimmed !== '') {
        nextCells.push(this.buildCell(row, column, trimmed, existingFormat));
      } else if (existingFormat) {
        nextCells.push({
          r: row,
          c: column,
          format: existingFormat
        });
      }
      nextCells.sort((a, b) => (a.r - b.r) || (a.c - b.c));
      return {
        ...sheet,
        celldata: nextCells,
        updatedAt: new Date().toISOString()
      };
    });

    const nextWorkbook: Workbook = {
      ...this.workbook,
      sheets: nextSheets,
      activeSheetId: this.activeSheet.id,
      updatedAt: new Date().toISOString()
    };

    const recalculated = this.recalculateWorkbook(nextWorkbook);
    this.applyWorkbook(recalculated);
    this.workbookChange.emit(recalculated);
  }

  private buildCell(row: number, column: number, value: string, format?: CellFormat): WorkbookCell {
    const isFormula = value.startsWith('=');
    const expression = isFormula ? value.slice(1).trim() : null;
    const initial = expression ? this.evaluateFormula(expression, this.workbook, this.activeSheet!.id) : null;

    const cell: WorkbookCell = {
      r: row,
      c: column,
      v: isFormula
        ? {
            f: expression ?? '',
            v: initial?.value ?? '',
            m: initial?.display ?? '#ERROR',
            error: initial?.error ?? undefined,
            ct: { t: 's' }
          }
        : {
            v: value,
            m: value,
            ct: { t: 's' }
          }
    };
    if (format) {
      cell.format = format;
    }
    return cell;
  }

  private positionEditor(): void {
    const target = this.findCellElement(this.selectedCell().row, this.selectedCell().column);
    if (!target) {
      return;
    }
    const body = this.gridBody.nativeElement;
    const cellRect = target.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    this.editorRect.set({
      top: cellRect.top - bodyRect.top + body.scrollTop,
      left: cellRect.left - bodyRect.left + body.scrollLeft,
      width: cellRect.width,
      height: cellRect.height
    });
  }

  private scheduleHandleUpdate(): void {
    if (this.handleUpdateScheduled || this.readOnly || this.editing()) {
      return;
    }
    this.handleUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.handleUpdateScheduled = false;
      this.updateFillHandle();
    });
  }

  private updateFillHandle(): void {
    if (this.readOnly || this.editing()) {
      this.fillHandleRect.set(null);
      return;
    }
    const range = this.getSelectionRange();
    const target = this.findCellElement(range.endRow, range.endCol);
    if (!target) {
      this.fillHandleRect.set(null);
      return;
    }
    const body = this.gridBody.nativeElement;
    const cellRect = target.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    this.fillHandleRect.set({
      top: cellRect.bottom - bodyRect.top + body.scrollTop - FILL_HANDLE_SIZE / 2,
      left: cellRect.right - bodyRect.left + body.scrollLeft - FILL_HANDLE_SIZE / 2,
      width: FILL_HANDLE_SIZE,
      height: FILL_HANDLE_SIZE
    });
  }

  private updateFillPreviewRect(range: FillRange | null): void {
    if (!range) {
      this.fillPreviewRect.set(null);
      return;
    }
    const minRow = Math.min(range.startRow, range.endRow);
    const maxRow = Math.max(range.startRow, range.endRow);
    const minCol = Math.min(range.startCol, range.endCol);
    const maxCol = Math.max(range.startCol, range.endCol);
    const topLeft = this.findCellElement(minRow, minCol);
    const bottomRight = this.findCellElement(maxRow, maxCol);
    if (!topLeft || !bottomRight) {
      this.fillPreviewRect.set(null);
      return;
    }
    const body = this.gridBody.nativeElement;
    const bodyRect = body.getBoundingClientRect();
    const topRect = topLeft.getBoundingClientRect();
    const bottomRect = bottomRight.getBoundingClientRect();
    this.fillPreviewRect.set({
      top: topRect.top - bodyRect.top + body.scrollTop,
      left: topRect.left - bodyRect.left + body.scrollLeft,
      width: bottomRect.right - topRect.left,
      height: bottomRect.bottom - topRect.top
    });
  }

  onFillHandlePointerDown(event: PointerEvent): void {
    if (this.readOnly) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.isFilling = true;
    this.fillSourceRange = this.getSelectionRange();
    this.fillPreview.set(null);
    this.fillPreviewRect.set(null);
    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp, { once: false });
  }

  private onFillPointerMove(event: PointerEvent): void {
    if (!this.isFilling || !this.fillSourceRange) {
      return;
    }
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const cellElement = element?.closest('[data-row][data-col]') as HTMLElement | null;
    if (!cellElement) {
      this.fillPreview.set(null);
      this.fillPreviewRect.set(null);
      return;
    }
    const row = Number(cellElement.dataset['row']);
    const column = Number(cellElement.dataset['col']);
    if (!Number.isFinite(row) || !Number.isFinite(column)) {
      this.fillPreview.set(null);
      this.fillPreviewRect.set(null);
      return;
    }
    const source = this.fillSourceRange;
    const base = normalizeRange(source);
    let target: FillRange | null = null;
    if (row > base.endRow) {
      target = { startRow: base.endRow + 1, endRow: row, startCol: base.startCol, endCol: base.endCol };
    } else if (row < base.startRow) {
      target = { startRow: row, endRow: base.startRow - 1, startCol: base.startCol, endCol: base.endCol };
    } else if (column > base.endCol) {
      target = { startRow: base.startRow, endRow: base.endRow, startCol: base.endCol + 1, endCol: column };
    } else if (column < base.startCol) {
      target = { startRow: base.startRow, endRow: base.endRow, startCol: column, endCol: base.startCol - 1 };
    }
    const normalized = target ? normalizeRange(target) : null;
    this.fillPreview.set(normalized);
    this.updateFillPreviewRect(normalized);
  }

  private onFillPointerUp(_event: PointerEvent): void {
    if (!this.isFilling) {
      return;
    }
    const range = this.fillPreview();
    this.detachFillListeners();
    this.fillPreview.set(null);
    this.fillPreviewRect.set(null);
    if (range) {
      this.applyFill(range);
    }
    this.scheduleHandleUpdate();
  }

  private detachFillListeners(): void {
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    this.isFilling = false;
    this.fillSourceRange = undefined;
  }

  private applyFill(range: FillRange): void {
    if (!this.activeSheet || this.readOnly) {
      return;
    }
    const baseRange = normalizeRange(this.fillSourceRange ?? this.getSelectionRange());
    const targetRange = normalizeRange(range);
    const baseHeight = baseRange.endRow - baseRange.startRow + 1;
    const baseWidth = baseRange.endCol - baseRange.startCol + 1;
    const targetHeight = targetRange.endRow - targetRange.startRow + 1;
    const targetWidth = targetRange.endCol - targetRange.startCol + 1;
    const downward = targetRange.startRow >= baseRange.endRow + 1 && targetRange.startCol === baseRange.startCol && targetRange.endCol === baseRange.endCol;
    const upward = targetRange.endRow <= baseRange.startRow - 1 && targetRange.startCol === baseRange.startCol && targetRange.endCol === baseRange.endCol;
    const rightward = targetRange.startCol >= baseRange.endCol + 1 && targetRange.startRow === baseRange.startRow && targetRange.endRow === baseRange.endRow;
    const leftward = targetRange.endCol <= baseRange.startCol - 1 && targetRange.startRow === baseRange.startRow && targetRange.endRow === baseRange.endRow;
    const vertical = downward || upward;
    const horizontal = rightward || leftward;
    if (!vertical && !horizontal) {
      return;
    }

    const sheet = this.activeSheet!;
    const baseMatrix = this.buildBaseMatrix(sheet, baseRange);
    const locale = this.workbook?.locale ?? 'en-US';
    const verticalPatterns = vertical ? this.computeVerticalPatterns(baseMatrix) : [];
    const horizontalPatterns = horizontal ? this.computeHorizontalPatterns(baseMatrix) : [];
    const dateFormatter = new Intl.DateTimeFormat(locale);

    const nextSheets = this.workbook.sheets.map(currentSheet => {
      if (currentSheet.id !== sheet.id) {
        return currentSheet;
      }
      let cells = (currentSheet.celldata ?? []).filter(cell => !this.coordinateWithinFillRange(cell.r, cell.c, targetRange));

      if (vertical) {
        const direction = downward ? 1 : -1;
        const totalRows = targetHeight;
        const steps = Math.ceil(totalRows / baseHeight);
        for (let step = 0; step < steps; step++) {
          for (let rowOffset = 0; rowOffset < baseHeight; rowOffset++) {
            const destIndex = step * baseHeight + rowOffset;
            if (destIndex >= totalRows) {
              break;
            }
            const destRow = direction > 0 ? targetRange.startRow + destIndex : targetRange.endRow - destIndex;
            const sourceRowOffset = direction > 0 ? rowOffset : baseHeight - 1 - rowOffset;
            for (let colOffset = 0; colOffset < baseWidth; colOffset++) {
              const destCol = baseRange.startCol + colOffset;
              const baseCellData = baseMatrix[sourceRowOffset][colOffset];
              const pattern = verticalPatterns[colOffset] ?? null;
              const relativeIndex = direction > 0 ? baseHeight + destIndex : -(destIndex + 1);
              const valueToWrite = this.resolvePatternValue(pattern, relativeIndex, baseCellData.display, dateFormatter);
              if (valueToWrite != null && valueToWrite !== '') {
                cells.push(this.buildCell(destRow, destCol, valueToWrite, baseCellData.format ? { ...baseCellData.format } : undefined));
              }
            }
          }
        }
      } else if (horizontal) {
        const direction = rightward ? 1 : -1;
        const totalCols = targetWidth;
        const steps = Math.ceil(totalCols / baseWidth);
        for (let step = 0; step < steps; step++) {
          for (let colOffset = 0; colOffset < baseWidth; colOffset++) {
            const destIndex = step * baseWidth + colOffset;
            if (destIndex >= totalCols) {
              break;
            }
            const destCol = direction > 0 ? targetRange.startCol + destIndex : targetRange.endCol - destIndex;
            const sourceColOffset = direction > 0 ? colOffset : baseWidth - 1 - colOffset;
            for (let rowOffset = 0; rowOffset < baseHeight; rowOffset++) {
              const destRow = baseRange.startRow + rowOffset;
              const baseCellData = baseMatrix[rowOffset][sourceColOffset];
              const pattern = horizontalPatterns[rowOffset] ?? null;
              const relativeIndex = direction > 0 ? baseWidth + destIndex : -(destIndex + 1);
              const valueToWrite = this.resolvePatternValue(pattern, relativeIndex, baseCellData.display, dateFormatter);
              if (valueToWrite != null && valueToWrite !== '') {
                cells.push(this.buildCell(destRow, destCol, valueToWrite, baseCellData.format ? { ...baseCellData.format } : undefined));
              }
            }
          }
        }
      }

      cells.sort((a, b) => (a.r - b.r) || (a.c - b.c));
      return {
        ...currentSheet,
        celldata: cells,
        updatedAt: new Date().toISOString()
      };
    });

    const nextWorkbook: Workbook = {
      ...this.workbook,
      sheets: nextSheets,
      updatedAt: new Date().toISOString()
    };

    const recalculated = this.recalculateWorkbook(nextWorkbook);
    this.applyWorkbook(recalculated);
    this.workbookChange.emit(recalculated);
  }

  private coordinateWithinFillRange(row: number, column: number, range: FillRange): boolean {
    const minRow = Math.min(range.startRow, range.endRow);
    const maxRow = Math.max(range.startRow, range.endRow);
    const minCol = Math.min(range.startCol, range.endCol);
    const maxCol = Math.max(range.startCol, range.endCol);
    return row >= minRow && row <= maxRow && column >= minCol && column <= maxCol;
  }

  private buildBaseMatrix(sheet: WorkbookSheet, base: FillRange): BaseCellData[][] {
    const normalized = normalizeRange(base);
    const height = normalized.endRow - normalized.startRow + 1;
    const width = normalized.endCol - normalized.startCol + 1;
    const matrix: BaseCellData[][] = [];
    for (let r = 0; r < height; r++) {
      const rowData: BaseCellData[] = [];
      for (let c = 0; c < width; c++) {
        const sourceRow = normalized.startRow + r;
        const sourceCol = normalized.startCol + c;
        const cell = sheet.celldata?.find(item => item.r === sourceRow && item.c === sourceCol);
        const raw = this.extractRawValue(cell);
        const display = this.extractDisplayValue(cell);
        const format = cell?.format ? { ...cell.format } : undefined;
        const rawNumber = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        const isNumeric = Number.isFinite(rawNumber);
        let dateValue: number | undefined;
        if (raw instanceof Date) {
          dateValue = raw.getTime();
        } else if (typeof raw === 'string') {
          const parsed = this.parseDateValue(raw);
          if (parsed != null) {
            dateValue = parsed;
          }
        }
        if (dateValue == null && typeof display === 'string') {
          const parsed = this.parseDateValue(display);
          if (parsed != null) {
            dateValue = parsed;
          }
        }
        rowData.push({
          raw,
          display,
          format,
          isNumeric,
          dateValue
        });
      }
      matrix.push(rowData);
    }
    return matrix;
  }

  private computeVerticalPatterns(matrix: BaseCellData[][]): Array<FillPattern | null> {
    if (!matrix.length) {
      return [];
    }
    const width = matrix[0].length;
    const patterns: Array<FillPattern | null> = [];
    for (let col = 0; col < width; col++) {
      const columnCells = matrix.map(row => row[col]!);
      patterns.push(this.detectLinearPattern(columnCells, 'number') ?? this.detectLinearPattern(columnCells, 'date'));
    }
    return patterns;
  }

  private computeHorizontalPatterns(matrix: BaseCellData[][]): Array<FillPattern | null> {
    if (!matrix.length) {
      return [];
    }
    return matrix.map(rowCells => this.detectLinearPattern(rowCells, 'number') ?? this.detectLinearPattern(rowCells, 'date'));
  }

  private detectLinearPattern(cells: BaseCellData[], kind: 'number' | 'date'): FillPattern | null {
    const values: number[] = [];
    for (const cell of cells) {
      if (kind === 'number') {
        const numeric = this.numericFromCell(cell);
        if (numeric == null) {
          return null;
        }
        values.push(numeric);
      } else {
        const dateNumeric = this.dateFromCell(cell);
        if (dateNumeric == null) {
          return null;
        }
        values.push(dateNumeric);
      }
    }
    if (!values.length) {
      return null;
    }
    if (values.length === 1) {
      const defaultStep = kind === 'number' ? 1 : 24 * 60 * 60 * 1000;
      return { kind, start: values[0], step: defaultStep };
    }
    let step = values[1] - values[0];
    for (let index = 2; index < values.length; index++) {
      const delta = values[index] - values[index - 1];
      if (!this.areNearlyEqual(delta, step)) {
        return null;
      }
    }
    return { kind, start: values[0], step };
  }

  private numericFromCell(cell: BaseCellData): number | null {
    if (!cell.isNumeric) {
      return null;
    }
    if (typeof cell.raw === 'number' && Number.isFinite(cell.raw)) {
      return cell.raw;
    }
    if (typeof cell.raw === 'string') {
      const parsed = Number(cell.raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    const parsedDisplay = Number(cell.display);
    return Number.isFinite(parsedDisplay) ? parsedDisplay : null;
  }

  private parseDateValue(input: string): number | null {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private dateFromCell(cell: BaseCellData): number | null {
    if (cell.dateValue == null || Number.isNaN(cell.dateValue)) {
      return null;
    }
    return cell.dateValue;
  }

  private resolvePatternValue(pattern: FillPattern | null, relativeIndex: number, fallback: string, formatter: Intl.DateTimeFormat): string {
    if (!pattern) {
      return fallback;
    }
    if (pattern.kind === 'number') {
      const computed = pattern.start + pattern.step * relativeIndex;
      return Number.isFinite(computed) ? String(computed) : fallback;
    }
    const computed = pattern.start + pattern.step * relativeIndex;
    const date = new Date(computed);
    if (Number.isNaN(date.getTime())) {
      return fallback;
    }
    return formatter.format(date);
  }

  private areNearlyEqual(a: number, b: number): boolean {
    const tolerance = 1e-9;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= tolerance * scale;
  }

  private extractRawValue(cell?: WorkbookCell): any {
    if (!cell || cell.v == null) {
      return '';
    }
    const payload = cell.v as any;
    if (typeof payload === 'object') {
      if (payload.v != null) {
        return payload.v;
      }
      if (payload.m != null) {
        return payload.m;
      }
    }
    return payload;
  }

  private extractDisplayValue(cell?: WorkbookCell): string {
    if (!cell || cell.v == null) {
      return '';
    }
    const payload = cell.v as any;
    if (typeof payload === 'object') {
      if (payload.m != null) {
        return String(payload.m);
      }
      if (payload.v != null) {
        return String(payload.v);
      }
    }
    return String(payload);
  }

  private findCellElement(row: number, column: number): HTMLElement | null {
    return this.gridBody.nativeElement.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${column}"]`);
  }

  private focusGrid(): void {
    this.gridContainer.nativeElement.focus();
  }

  private getCellFormat(row: number, column: number): CellFormat | undefined {
    return this.cellMap.get(this.cellKey(row, column))?.format;
  }

  private recalculateWorkbook(input: Workbook): Workbook {
    const working: Workbook = {
      ...input,
      sheets: input.sheets.map(sheet => ({
        ...sheet,
        celldata: (sheet.celldata ?? []).map(cell => ({
          ...cell,
          v: cell.v && typeof cell.v === 'object' ? { ...(cell.v as any) } : cell.v,
          format: cell.format ? { ...cell.format } : undefined
        }))
      }))
    };

    for (const sheet of working.sheets) {
      for (const cell of sheet.celldata ?? []) {
        const payload = cell.v;
        if (payload && typeof payload === 'object' && typeof (payload as any).f === 'string') {
          const formula = (payload as any).f as string;
          const result = this.evaluateFormula(formula, working, sheet.id);
          const updated: any = {
            ...(payload as any),
            f: formula,
            v: result.value,
            m: result.display
          };
          if (result.error) {
            updated.error = result.error;
          } else if (updated.error) {
            delete updated.error;
          }
          cell.v = updated;
        }
      }
    }

    return working;
  }

  private evaluateFormula(formula: string, workbook: Workbook, sheetId: string): FormulaComputation {
    try {
      const context = new FormulaContext(workbook, sheetId);
      const parser = new FormulaParser(formula, context);
      const value = parser.parse();
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          return { value: null, display: '#DIV/0!', error: 'Division by zero' };
        }
        return { value, display: String(value) };
      }
      if (typeof value === 'boolean') {
        return { value, display: value ? 'TRUE' : 'FALSE' };
      }
      if (value == null) {
        return { value: '', display: '', error: undefined };
      }
      return { value, display: String(value) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid formula';
      return { value: null, display: '#ERROR', error: message || 'Invalid formula' };
    }
  }

  private formatNumber(value: number, format: NumberFormat): string {
    switch (format) {
      case 'number':
        return new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        }).format(value);
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 2
        }).format(value);
      case 'percent':
        return new Intl.NumberFormat('en-US', {
          style: 'percent',
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        }).format(value);
      default:
        return String(value);
    }
  }

  private cellKey(row: number, column: number): string {
    return `${row}:${column}`;
  }

}

const DEFAULT_ROW_COUNT = 100;
const DEFAULT_COLUMN_COUNT = 26;
const EXTRA_ROWS = 20;
const EXTRA_COLUMNS = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function columnLabel(index: number): string {
  let label = '';
  let current = index;
  do {
    const remainder = current % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

function columnIndexFromLabel(label: string): number {
  let result = 0;
  for (let i = 0; i < label.length; i++) {
    result = result * 26 + (label.charCodeAt(i) - 64);
  }
  return result - 1;
}

function coerceToNumber(value: any): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRange(range: FillRange): FillRange {
  const startRow = Math.min(range.startRow, range.endRow);
  const endRow = Math.max(range.startRow, range.endRow);
  const startCol = Math.min(range.startCol, range.endCol);
  const endCol = Math.max(range.startCol, range.endCol);
  return {
    startRow,
    startCol,
    endRow,
    endCol
  };
}

interface ReferenceAddress {
  sheet: WorkbookSheet;
  row: number;
  column: number;
}

function resolveSheet(workbook: Workbook, identifier: string | undefined, fallbackSheetId: string): WorkbookSheet {
  if (identifier) {
    let normalized = identifier.trim();
    if (normalized.startsWith("'") && normalized.endsWith("'")) {
      normalized = normalized.slice(1, -1).replace(/''/g, "'");
    }
    const lowered = normalized.toLowerCase();
    const byId = workbook.sheets.find(sheet => sheet.id.toLowerCase() === lowered);
    if (byId) {
      return byId;
    }
    const byName = workbook.sheets.find(sheet => (sheet.name ?? '').toLowerCase() === lowered);
    if (byName) {
      return byName;
    }
    throw new Error(`Unknown sheet ${identifier}`);
  }
  const byId = workbook.sheets.find(sheet => sheet.id === fallbackSheetId);
  if (byId) {
    return byId;
  }
  const fallbackByName = workbook.sheets.find(sheet => (sheet.name ?? '').toLowerCase() === fallbackSheetId.toLowerCase());
  if (fallbackByName) {
    return fallbackByName;
  }
  throw new Error('Sheet not found');
}

function parseReferenceAddress(token: string, workbook: Workbook, fallbackSheetId: string): ReferenceAddress {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Invalid reference');
  }
  const segments = trimmed.split('!');
  let sheetQualifier: string | undefined;
  let cellPart: string;
  if (segments.length === 2) {
    sheetQualifier = segments[0].trim();
    cellPart = segments[1].trim();
  } else if (segments.length === 1) {
    cellPart = segments[0].trim();
  } else {
    throw new Error(`Invalid reference ${token}`);
  }
  if (sheetQualifier) {
    if (sheetQualifier.startsWith("'") && sheetQualifier.endsWith("'")) {
      sheetQualifier = sheetQualifier.slice(1, -1).replace(/''/g, "'");
    }
  }
  const normalizedCell = cellPart.replace(/\$/g, '').toUpperCase();
  const match = /^([A-Z]+)([0-9]+)$/.exec(normalizedCell);
  if (!match) {
    throw new Error(`Invalid reference ${token}`);
  }
  const column = columnIndexFromLabel(match[1]);
  const row = Number.parseInt(match[2], 10) - 1;
  if (row < 0) {
    throw new Error(`Invalid reference ${token}`);
  }
  const sheet = resolveSheet(workbook, sheetQualifier, fallbackSheetId);
  return { sheet, row, column };
}

interface FormulaComputation {
  value: any;
  display: string;
  error?: string;
}

class FormulaContext {
  constructor(private readonly workbook: Workbook, private readonly sheetId: string) {}

  resolveReference(identifier: string): any {
    const trimmed = identifier.trim();
    const upper = trimmed.toUpperCase();
    if (!trimmed.includes('!') && !/[0-9]/.test(trimmed)) {
      if (upper === 'TRUE') {
        return true;
      }
      if (upper === 'FALSE') {
        return false;
      }
      if (upper === 'PI') {
        return Math.PI;
      }
    }
    const address = parseReferenceAddress(trimmed, this.workbook, this.sheetId);
    const cell = address.sheet.celldata?.find(c => c.r === address.row && c.c === address.column);
    return this.extractCellValue(cell);
  }

  resolveRange(startRef: string, endRef: string): any[] {
    const startAddress = parseReferenceAddress(startRef, this.workbook, this.sheetId);
    const endAddress = parseReferenceAddress(endRef, this.workbook, startAddress.sheet.id);
    if (startAddress.sheet.id !== endAddress.sheet.id) {
      throw new Error('Cross-sheet ranges are not supported');
    }
    const sheet = startAddress.sheet;
    const minRow = Math.min(startAddress.row, endAddress.row);
    const maxRow = Math.max(startAddress.row, endAddress.row);
    const minCol = Math.min(startAddress.column, endAddress.column);
    const maxCol = Math.max(startAddress.column, endAddress.column);
    const values: any[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = sheet.celldata?.find(c => c.r === row && c.c === col);
        values.push(this.extractCellValue(cell));
      }
    }
    return values;
  }

  applyFunction(name: string, args: any[]): any {
    const identifier = name.trim().toUpperCase();
    switch (identifier) {
      case 'SUM': {
        const numbers = this.collectNumeric(args);
        return numbers.reduce((total, value) => total + value, 0);
      }
      case 'AVERAGE': {
        const numbers = this.collectNumeric(args);
        if (!numbers.length) {
          throw new Error('AVERAGE requires at least one numeric value');
        }
        const total = numbers.reduce((sum, value) => sum + value, 0);
        return total / numbers.length;
      }
      case 'MIN': {
        const numbers = this.collectNumeric(args);
        if (!numbers.length) {
          throw new Error('MIN requires at least one numeric value');
        }
        return Math.min(...numbers);
      }
      case 'MAX': {
        const numbers = this.collectNumeric(args);
        if (!numbers.length) {
          throw new Error('MAX requires at least one numeric value');
        }
        return Math.max(...numbers);
      }
      case 'COUNT': {
        const values = this.flattenArgs(args);
        return values.filter(value => this.isNumericValue(value)).length;
      }
      case 'COUNTA': {
        const values = this.flattenArgs(args);
        return values.filter(value => this.isNonEmpty(value)).length;
      }
      case 'IF': {
        if (args.length < 2) {
          throw new Error('IF requires at least two arguments');
        }
        const condition = this.toBoolean(args[0]);
        if (condition) {
          return args.length >= 2 ? this.unwrapScalar(args[1]) : '';
        }
        return args.length >= 3 ? this.unwrapScalar(args[2]) : '';
      }
      default:
        throw new Error(`Unsupported function ${name}`);
    }
  }

  private extractCellValue(cell?: WorkbookCell): any {
    if (!cell || cell.v == null) {
      return '';
    }
    const payload: any = cell.v;
    if (typeof payload === 'object' && payload) {
      if (typeof payload.error === 'string' && payload.error.trim() !== '') {
        throw new Error(payload.error);
      }
      if (payload.v != null) {
        return payload.v;
      }
      if (payload.m != null) {
        return payload.m;
      }
      return '';
    }
    return payload;
  }

  private collectNumeric(args: any[]): number[] {
    const flattened = this.flattenArgs(args).map(value => this.unwrapScalar(value));
    const result: number[] = [];
    for (const entry of flattened) {
      if (typeof entry === 'boolean') {
        result.push(entry ? 1 : 0);
        continue;
      }
      if (this.isNumericValue(entry)) {
        result.push(this.coerceNumeric(entry));
      }
    }
    return result;
  }

  private flattenArgs(args: any[]): any[] {
    const output: any[] = [];
    for (const arg of args) {
      this.flattenInto(arg, output);
    }
    return output;
  }

  private flattenInto(value: any, target: any[]): void {
    if (Array.isArray(value)) {
      for (const entry of value) {
        this.flattenInto(entry, target);
      }
      return;
    }
    target.push(value);
  }

  private unwrapScalar(value: any): any {
    if (Array.isArray(value)) {
      return value.length ? this.unwrapScalar(value[0]) : '';
    }
    return value;
  }

  private isNumericValue(value: any): boolean {
    const unwrapped = this.unwrapScalar(value);
    if (typeof unwrapped === 'number') {
      return Number.isFinite(unwrapped);
    }
    if (typeof unwrapped === 'string') {
      const trimmed = unwrapped.trim();
      if (trimmed === '') {
        return false;
      }
      return Number.isFinite(Number(trimmed));
    }
    return false;
  }

  private coerceNumeric(value: any): number {
    const unwrapped = this.unwrapScalar(value);
    if (typeof unwrapped === 'number') {
      return Number.isFinite(unwrapped) ? unwrapped : 0;
    }
    if (typeof unwrapped === 'boolean') {
      return unwrapped ? 1 : 0;
    }
    const parsed = Number(unwrapped);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private isNonEmpty(value: any): boolean {
    const unwrapped = this.unwrapScalar(value);
    if (unwrapped == null) {
      return false;
    }
    if (typeof unwrapped === 'string') {
      return unwrapped.length > 0;
    }
    if (Array.isArray(unwrapped)) {
      return unwrapped.some(entry => this.isNonEmpty(entry));
    }
    return true;
  }

  private toBoolean(value: any): boolean {
    const unwrapped = this.unwrapScalar(value);
    if (typeof unwrapped === 'boolean') {
      return unwrapped;
    }
    if (typeof unwrapped === 'number') {
      return unwrapped !== 0;
    }
    if (typeof unwrapped === 'string') {
      const trimmed = unwrapped.trim();
      if (trimmed === '') {
        return false;
      }
      const upper = trimmed.toUpperCase();
      if (upper === 'TRUE') {
        return true;
      }
      if (upper === 'FALSE') {
        return false;
      }
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric !== 0;
      }
      return true;
    }
    return Boolean(unwrapped);
  }
}

class FormulaParser {
  private index = 0;

  constructor(private readonly expression: string, private readonly context: FormulaContext) {}

  parse(): any {
    const result = this.parseExpression();
    this.skipWhitespace();
    if (this.index < this.expression.length) {
      throw new Error('Unexpected token');
    }
    return result;
  }

  private parseExpression(): any {
    let value = this.parseAdditive();
    while (true) {
      this.skipWhitespace();
      const operator = this.peekComparisonOperator();
      if (!operator) {
        break;
      }
      this.index += operator.length;
      const right = this.parseAdditive();
      value = this.evaluateComparison(operator, value, right);
    }
    return value;
  }

  private parseAdditive(): any {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      const char = this.peek();
      if (char === '+' || char === '-') {
        this.index++;
        const right = this.parseTerm();
        const leftNum = coerceToNumber(value);
        const rightNum = coerceToNumber(right);
        value = char === '+' ? leftNum + rightNum : leftNum - rightNum;
      } else {
        break;
      }
    }
    return value;
  }

  private parseTerm(): any {
    let value = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      const char = this.peek();
      if (char === '*' || char === '/') {
        this.index++;
        const right = this.parseFactor();
        const leftNum = coerceToNumber(value);
        const rightNum = coerceToNumber(right);
        if (char === '/') {
          if (rightNum === 0) {
            throw new Error('Division by zero');
          }
          value = leftNum / rightNum;
        } else {
          value = leftNum * rightNum;
        }
      } else {
        break;
      }
    }
    return value;
  }

  private parseFactor(): any {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '+') {
      this.index++;
      return this.parseFactor();
    }
    if (char === '-') {
      this.index++;
      const value = this.parseFactor();
      return -coerceToNumber(value);
    }
    if (char === '(') {
      this.index++;
      const value = this.parseExpression();
      this.expect(')');
      return value;
    }
    if (this.isDigit(char) || char === '.') {
      return this.parseNumber();
    }
    if (this.isAlpha(char)) {
      return this.parseIdentifier();
    }
    throw new Error('Unexpected factor');
  }

  private parseNumber(): number {
    const start = this.index;
    while (this.isDigit(this.peek())) {
      this.index++;
    }
    if (this.peek() === '.') {
      this.index++;
      while (this.isDigit(this.peek())) {
        this.index++;
      }
    }
    const raw = this.expression.slice(start, this.index);
    return Number.parseFloat(raw);
  }

  private parseIdentifier(): any {
    const identifier = this.parseReferenceToken();
    this.skipWhitespace();
    if (this.peek() === '(') {
      this.index++;
      const args: any[] = [];
      this.skipWhitespace();
      if (this.peek() !== ')') {
        while (true) {
          const arg = this.parseExpression();
          args.push(arg);
          this.skipWhitespace();
          if (this.peek() === ',') {
            this.index++;
            this.skipWhitespace();
            continue;
          }
          break;
        }
      }
      this.expect(')');
      return this.context.applyFunction(identifier, args);
    }
    this.skipWhitespace();
    if (this.peek() === ':') {
      this.index++;
      this.skipWhitespace();
      const endToken = this.parseReferenceToken();
      return this.context.resolveRange(identifier, endToken);
    }
    return this.context.resolveReference(identifier);
  }

  private peekComparisonOperator(): string | null {
    const remaining = this.expression.slice(this.index);
    if (remaining.startsWith('<=')) {
      return '<=';
    }
    if (remaining.startsWith('>=')) {
      return '>=';
    }
    if (remaining.startsWith('<>')) {
      return '<>';
    }
    const char = this.peek();
    if (char === '<' || char === '>' || char === '=') {
      return char;
    }
    return null;
  }

  private evaluateComparison(operator: string, left: any, right: any): boolean {
    const leftValue = this.unwrapComparisonValue(left);
    const rightValue = this.unwrapComparisonValue(right);
    const leftNumeric = this.tryCoerceNumber(leftValue);
    const rightNumeric = this.tryCoerceNumber(rightValue);

    if (leftNumeric.ok && rightNumeric.ok) {
      switch (operator) {
        case '=':
          return leftNumeric.value === rightNumeric.value;
        case '<>':
          return leftNumeric.value !== rightNumeric.value;
        case '>':
          return leftNumeric.value > rightNumeric.value;
        case '<':
          return leftNumeric.value < rightNumeric.value;
        case '>=':
          return leftNumeric.value >= rightNumeric.value;
        case '<=':
          return leftNumeric.value <= rightNumeric.value;
        default:
          throw new Error(`Unsupported comparison operator ${operator}`);
      }
    }

    const leftString = this.normalizeComparisonString(leftValue);
    const rightString = this.normalizeComparisonString(rightValue);
    const comparison = leftString.localeCompare(rightString, undefined, { sensitivity: 'base' });
    switch (operator) {
      case '=':
        return comparison === 0;
      case '<>':
        return comparison !== 0;
      case '>':
        return comparison > 0;
      case '<':
        return comparison < 0;
      case '>=':
        return comparison >= 0;
      case '<=':
        return comparison <= 0;
      default:
        throw new Error(`Unsupported comparison operator ${operator}`);
    }
  }

  private unwrapComparisonValue(value: any): any {
    if (Array.isArray(value)) {
      return value.length ? this.unwrapComparisonValue(value[0]) : '';
    }
    return value;
  }

  private tryCoerceNumber(value: any): { ok: boolean; value: number } {
    if (value == null) {
      return { ok: false, value: 0 };
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: 0 };
    }
    if (typeof value === 'boolean') {
      return { ok: true, value: value ? 1 : 0 };
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        return { ok: false, value: 0 };
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return { ok: true, value: parsed };
      }
    }
    return { ok: false, value: 0 };
  }

  private normalizeComparisonString(value: any): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    return String(value).trim();
  }

  private parseReferenceToken(): string {
    const start = this.index;
    if (this.peek() === "'") {
      this.index++;
      while (this.index < this.expression.length) {
        const ch = this.expression[this.index++];
        if (ch === "'") {
          if (this.peek() === "'") {
            this.index++;
          } else {
            break;
          }
        }
      }
      if (this.peek() !== '!') {
        throw new Error('Invalid sheet reference');
      }
      this.index++;
    }
    while (this.isAlphaNumeric(this.peek()) || this.peek() === '$') {
      this.index++;
    }
    if (start === this.index) {
      throw new Error('Expected reference');
    }
    return this.expression.slice(start, this.index);
  }

  private skipWhitespace(): void {
    while (this.index < this.expression.length && /\s/.test(this.expression[this.index]!)) {
      this.index++;
    }
  }

  private peek(): string | undefined {
    if (this.index >= this.expression.length) {
      return undefined;
    }
    return this.expression[this.index];
  }

  private expect(char: string): void {
    this.skipWhitespace();
    if (this.expression[this.index] !== char) {
      throw new Error(`Expected ${char}`);
    }
    this.index++;
  }

  private isDigit(char: string | undefined): boolean {
    return char != null && char >= '0' && char <= '9';
  }

  private isAlpha(char: string | undefined): boolean {
    return char != null && /[A-Za-z]/.test(char);
  }

  private isAlphaNumeric(char: string | undefined): boolean {
    return char != null && /[A-Za-z0-9_]/.test(char);
  }
}
