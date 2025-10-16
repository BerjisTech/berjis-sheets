import { Component, OnInit, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SheetsService, SheetDoc, defaultGrid } from '../../sheets.service';

@Component({
  standalone: true,
  selector: 'app-sheet',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './sheet.component.html'
})
export class SheetPageComponent implements OnInit, AfterViewInit {
  sheet: SheetDoc | null = null;
  grid: string[][] = defaultGrid();
  pendingSave?: any;
  openModal = false;
  openId = '';
  openQuery = '';
  openRows: SheetDoc[] = [];
  openFiltered: SheetDoc[] = [];
  contextMenus: { name: string, menus: { icon: string, name: string, action: string }[] }[] = [
    { name: 'File', menus: [
      { icon: '', name: 'New', action: 'new' },
      { icon: '', name: 'Open', action: 'open' },
      { icon: '', name: 'Rename', action: 'rename' },
      { icon: '', name: 'Make a copy', action: 'copy' },
      { icon: '', name: 'Download (.csv)', action: 'download' },
      { icon: '', name: 'Settings', action: 'settings' },
      { icon: '', name: 'Print', action: 'print' }
    ]},
    { name: 'Edit', menus: [
      { icon: '', name: 'Undo', action: 'undo' },
      { icon: '', name: 'Redo', action: 'redo' }
    ]},
    { name: 'View', menus: [
      { icon: '', name: 'Freeze', action: 'freeze' },
      { icon: '', name: 'Gridlines', action: 'gridlines' },
      { icon: '', name: 'Zoom', action: 'zoom' }
    ]},
    { name: 'Insert', menus: [
      { icon: '', name: 'Row above', action: 'rowAbove' },
      { icon: '', name: 'Row below', action: 'rowBelow' },
      { icon: '', name: 'Column left', action: 'colLeft' },
      { icon: '', name: 'Column right', action: 'colRight' },
      { icon: '', name: 'Function', action: 'function' }
    ]},
    { name: 'Format', menus: [
      { icon: '', name: 'Number', action: 'number' },
      { icon: '', name: 'Text wrapping', action: 'wrap' },
      { icon: '', name: 'Merge cells', action: 'merge' }
    ]},
    { name: 'Data', menus: [
      { icon: '', name: 'Sort range', action: 'sortRange' },
      { icon: '', name: 'Data validation', action: 'dataValidation' }
    ]},
    { name: 'Tools', menus: [
      { icon: '', name: 'Spell check', action: 'spell' }
    ]},
    { name: 'Extensions', menus: [
      { icon: '', name: 'Add-ons', action: 'addons' }
    ]},
    { name: 'Help', menus: [
      { icon: '', name: 'Sheets help', action: 'help' }
    ]},
  ]

  onMenu(action: string){
    switch(action){
      case 'new': this.router.navigate(['/sheet','new']); break;
      case 'open': { this.showOpen(); break; }
      case 'copy': this.copySheet(); break;
      case 'rename': this.showRename(); break;
      case 'download': this.downloadCsv(); break;
      case 'print': window.print(); break;
      case 'rowAbove': this.grid.unshift(Array.from({ length: this.grid[0]?.length||10 },()=>'')); this.queueSave(); break;
      case 'rowBelow': this.addRow(); break;
      case 'colLeft': for(const row of this.grid) row.unshift(''); this.queueSave(); break;
      case 'colRight': this.addCol(); break;
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
      default: break;
    }
  }

  private async copySheet(){
    if (!this.sheet) return;
    const created = await this.sheets.create({ title: (this.sheet.title||'Untitled')+' (Copy)', data: this.packData() });
    this.sheet = created; this.router.navigate(['/sheet', created.id]);
  }
  private downloadCsv(){
    const name = ((this.sheet?.title)||'sheet').replace(/\s+/g,'-').slice(0,80);
    const csv = this.grid.map(row => row.map(cell => '"'+String(cell).replace(/"/g,'""')+'"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  private async showOpen(){ this.openModal = true; try { this.openRows = await this.sheets.list(['active']); } catch { this.openRows = []; } this.openFiltered=[...this.openRows]; this.openQuery=''; }
  onOpenQueryChange(){ const q=(this.openQuery||'').toLowerCase(); if(!q){ this.openFiltered=[...this.openRows]; return; } this.openFiltered = this.openRows.filter(s => (s.title||'').toLowerCase().includes(q) || JSON.stringify(s.data||'').toLowerCase().includes(q)); }
  openSheet(s: SheetDoc){ this.openModal=false; this.router.navigate(['/sheet', s.id]); }
  // Rename modal
  renameModal = false; renameTitle = '';
  private showRename(){ this.renameTitle=(this.sheet?.title||''); this.renameModal=true; }
  confirmRename(){ if(!this.sheet){ this.renameModal=false; return; } this.sheet.title=(this.renameTitle||'').trim(); this.renameModal=false; this.onTitleChange(); }
  cancelRename(){ this.renameModal=false; }
  confirmOpen(){ const id=(this.openId||'').trim(); if (id){ this.openModal=false; this.router.navigate(['/sheet', id]); } }
  cancelOpen(){ this.openModal=false; }

  constructor(private route: ActivatedRoute, private router: Router, public sheets: SheetsService) { }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') || 'new';
    this.sheet = { id, title: '', data: defaultGrid(), status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (id !== 'new') {
      const existing = this.sheets.get(id) || await this.sheets.fetch(id);
      if (existing) this.sheet = existing; else { this.router.navigate(['/']); return; }
    }
    const data: any = this.sheet?.data;
    if (Array.isArray(data)) {
      this.grid = data as string[][];
      this.initSizing();
    } else if (data && Array.isArray(data.grid)) {
      this.grid = data.grid as string[][];
      this.colWidths = Array.isArray(data.colWidths) && data.colWidths.length ? data.colWidths.slice() : Array.from({ length: this.grid[0]?.length || 0 }, () => this.defaultColWidth);
      this.rowHeights = Array.isArray(data.rowHeights) && data.rowHeights.length ? data.rowHeights.slice() : Array.from({ length: this.grid.length }, () => this.defaultRowHeight);
      this.recomputeRowOffsets();
    } else {
      this.grid = defaultGrid();
      this.initSizing();
    }
    this.updateViewport();
  }

  ngAfterViewInit(): void {
    // Attach scroll listener after view init
    setTimeout(() => {
      this.editorMainPane?.nativeElement?.addEventListener('scroll', () => this.updateViewport());
      window.addEventListener('mouseup', () => this.onGlobalMouseUp());
      window.addEventListener('mousemove', (e) => this.onGlobalMouseMove(e));
      this.updateViewport();
    }, 0);
  }

  onTitleChange() { this.queueSave(); }
  onCellChange(r: number, c: number, val: string) { if (!this.sheet) return; this.grid[r][c] = val; this.sheet.data = this.packData(); this.queueSave(); }

  addRow() { this.grid.push(Array.from({ length: this.grid[0]?.length || 10 }, () => '')); this.rowHeights.push(this.defaultRowHeight); this.recomputeRowOffsets(); this.sheet!.data = this.packData(); this.queueSave(); }
  addCol() { for (const row of this.grid) row.push(''); this.colWidths.push(this.defaultColWidth); this.sheet!.data = this.packData(); this.queueSave(); }

  private queueSave() { if (!this.sheet) return; if (this.pendingSave) clearTimeout(this.pendingSave); this.pendingSave = setTimeout(() => this.save(), 400); }
  private async ensureCreatedId() { if (this.sheet && this.sheet.id === 'new') { const hasTitle = !!this.sheet.title && this.sheet.title.trim().length > 0; const hasData = JSON.stringify(this.grid).length > 2; if (hasTitle || hasData) { const created = await this.sheets.create({ title: this.sheet.title, data: this.packData() }); this.sheet = created; this.router.navigate(['/sheet', created.id], { replaceUrl: true }); } } }
  private async save() { if (!this.sheet) return; await this.ensureCreatedId(); if (!this.sheet) return; this.sheet.data = this.packData(); await this.sheets.save(this.sheet); }

  colLabel(i: number): string {
    // Convert 0-based index to Excel-like letters: 0->A, 25->Z, 26->AA
    let n = i;
    let s = '';
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  }

  trackRow = (_: number, __: string[]) => _;
  trackVisibleRow = (_: number, v: { ri: number, row: string[] }) => v.ri;
  trackCol = (_: number, __: string) => _;

  onCellKeydown(e: KeyboardEvent, ri: number, ci: number) {
    // Basic navigation: arrows, Enter, Tab
    const key = e.key;
    if (key === 'Enter') { e.preventDefault(); this.moveFocus(ri + 1, ci); return; }
    if (key === 'Tab') { e.preventDefault(); if (e.shiftKey) this.moveFocus(ri, ci - 1); else this.moveFocus(ri, ci + 1); return; }
    const nav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    if (nav.includes(key)) {
      e.preventDefault();
      let r = ri, c = ci;
      if (key === 'ArrowUp') r = Math.max(0, ri - 1);
      if (key === 'ArrowDown') r = Math.min(this.grid.length - 1, ri + 1);
      if (key === 'ArrowLeft') c = Math.max(0, ci - 1);
      if (key === 'ArrowRight') c = Math.min((this.grid[0]?.length||1) - 1, ci + 1);
      if (e.shiftKey) {
        // Expand range from activeCell if exists, else from current
        const start = this.activeCell || { r: ri, c: ci };
        this.rangeStart = start; this.rangeEnd = { r, c }; this.activeCell = { r, c };
      } else {
        this.rangeStart = null; this.rangeEnd = null; this.multiSelected.clear();
        this.activeCell = { r, c };
      }
      this.moveFocus(r, c);
    }
  }

  // Viewport virtualization
  @ViewChild('editorMainPane') editorMainPane?: ElementRef<HTMLDivElement>;
  defaultRowHeight = 32; // px
  defaultColWidth = 96;  // px
  rowHeights: number[] = [];
  colWidths: number[] = [];
  rowOffsets: number[] = []; // cumulative top positions of rows
  viewStartRow = 0;
  viewRowCount = 40; // will be computed based on viewport
  topSpacer = 0;
  bottomSpacer = 0;
  get totalTableWidth(): number { try { return 40 + (this.colWidths?.reduce((a,b)=>a+(b||this.defaultColWidth),0)||0); } catch { return 40 + (this.grid[0]?.length||0)*this.defaultColWidth; } }

  private initSizing() {
    const rows = this.grid.length;
    const cols = this.grid[0]?.length || 0;
    this.rowHeights = Array.from({ length: rows }, () => this.defaultRowHeight);
    this.colWidths = Array.from({ length: cols }, () => this.defaultColWidth);
    this.recomputeRowOffsets();
  }
  private recomputeRowOffsets() {
    this.rowOffsets = new Array(this.rowHeights.length + 1);
    this.rowOffsets[0] = 0;
    for (let i = 0; i < this.rowHeights.length; i++) this.rowOffsets[i + 1] = this.rowOffsets[i] + this.rowHeights[i];
  }
  private findRowAtOffset(offset: number): number {
    // Linear scan is fine for 1000 rows; simple and robust with variable heights
    const total = this.rowHeights.length;
    let sum = 0;
    for (let i = 0; i < total; i++) { sum += this.rowHeights[i]; if (sum > offset) return i; }
    return Math.max(0, total - 1);
  }
  updateViewport() {
    const el = this.editorMainPane?.nativeElement; if (!el) return;
    const scrollTop = el.scrollTop;
    const vh = el.clientHeight || 600;
    const start = this.findRowAtOffset(scrollTop);
    let covered = 0; let end = start;
    const need = vh + 200; // buffer
    while (end < this.rowHeights.length && covered < need) { covered += this.rowHeights[end]; end++; }
    this.viewStartRow = Math.max(0, start - 3);
    const viewEnd = Math.min(this.grid.length, end + 3);
    this.viewRowCount = Math.max(0, viewEnd - this.viewStartRow);
    const before = this.rowOffsets[this.viewStartRow] || 0;
    const after = (this.rowOffsets[this.rowOffsets.length - 1] || 0) - (this.rowOffsets[this.viewStartRow + this.viewRowCount] || 0);
    this.topSpacer = before;
    this.bottomSpacer = after;
  }
  get visibleRows(): { ri: number, row: string[] }[] {
    const out: { ri: number, row: string[] }[] = [];
    for (let i = 0; i < this.viewRowCount; i++) {
      const ri = this.viewStartRow + i; if (ri >= this.grid.length) break;
      out.push({ ri, row: this.grid[ri] });
    }
    return out;
  }

  // Selection handling
  activeCell: { r: number, c: number } | null = null;
  dragging = false;
  rangeStart: { r: number, c: number } | null = null;
  rangeEnd: { r: number, c: number } | null = null;
  multiSelected = new Set<string>();

  selectColumn(ci: number){
    this.multiSelected.clear();
    this.rangeStart = { r: 0, c: ci };
    this.rangeEnd = { r: Math.max(0, this.grid.length-1), c: ci };
    this.activeCell = { r: 0, c: ci };
    this.ensureCellVisible(0, ci);
  }
  selectRow(ri: number){
    this.multiSelected.clear();
    this.rangeStart = { r: ri, c: 0 };
    this.rangeEnd = { r: ri, c: Math.max(0, (this.grid[0]?.length||1)-1) };
    this.activeCell = { r: ri, c: 0 };
    this.ensureCellVisible(ri, 0);
  }

  onCellMouseDown(e: MouseEvent, ri: number, ci: number) {
    if (e.shiftKey && this.activeCell) {
      this.rangeStart = { r: this.activeCell.r, c: this.activeCell.c };
      this.rangeEnd = { r: ri, c: ci };
      this.activeCell = { r: ri, c: ci };
      this.dragging = false; return;
    }
    if (e.ctrlKey || e.metaKey) {
      const key = `${ri}-${ci}`;
      if (this.multiSelected.has(key)) this.multiSelected.delete(key); else this.multiSelected.add(key);
      this.activeCell = { r: ri, c: ci };
      return;
    }
    this.activeCell = { r: ri, c: ci };
    this.rangeStart = { r: ri, c: ci };
    this.rangeEnd = { r: ri, c: ci };
    this.dragging = true;
  }
  onCellMouseEnter(ri: number, ci: number) {
    if (!this.dragging || !this.rangeStart) return;
    this.rangeEnd = { r: ri, c: ci };
  }
  onGlobalMouseUp() { this.dragging = false; this.endResizing(); }
  isCellActive(ri: number, ci: number): boolean { return !!this.activeCell && this.activeCell.r === ri && this.activeCell.c === ci; }
  isCellInRange(ri: number, ci: number): boolean {
    if (!this.rangeStart || !this.rangeEnd) return false;
    const r1 = Math.min(this.rangeStart.r, this.rangeEnd.r);
    const r2 = Math.max(this.rangeStart.r, this.rangeEnd.r);
    const c1 = Math.min(this.rangeStart.c, this.rangeEnd.c);
    const c2 = Math.max(this.rangeStart.c, this.rangeEnd.c);
    return ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2;
  }
  isCellMulti(ri: number, ci: number): boolean { return this.multiSelected.has(`${ri}-${ci}`); }
  isCellSelected(ri: number, ci: number): boolean { return this.isCellActive(ri, ci) || this.isCellInRange(ri, ci) || this.isCellMulti(ri, ci); }

  // Column resizing
  resizingCol: { index: number, startX: number, startW: number } | null = null;
  resizingRow: { index: number, startY: number, startH: number } | null = null;
  startColResize(ci: number, e: MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    this.resizingCol = { index: ci, startX: e.clientX, startW: this.colWidths[ci] };
  }
  startRowResize(ri: number, e: MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    this.resizingRow = { index: ri, startY: e.clientY, startH: this.rowHeights[ri] };
  }
  autoSizeCol(ci: number){
    const header = this.colLabel(ci);
    let maxContentWidth = this.measureText(header);
    let hasContent = false;
    for (let r = 0; r < this.grid.length; r++) {
      const val = (this.grid[r]?.[ci] ?? '').toString();
      if (val.trim().length > 0) hasContent = true;
      const w = this.measureText(val);
      if (w > maxContentWidth) maxContentWidth = w;
    }
    const minW = 40; const defaultW = this.defaultColWidth;
    const target = hasContent ? Math.max(minW, maxContentWidth) : defaultW;
    this.colWidths[ci] = target;
    this.queueSave();
  }
  autoSizeRow(ri: number){
    let maxH = 0; let hasContent = false;
    for (let c = 0; c < (this.grid[ri]?.length||0); c++) {
      const val = (this.grid[ri]?.[c] ?? '').toString();
      if (val.trim().length > 0) hasContent = true;
      const h = this.measureTextHeight(val);
      if (h > maxH) maxH = h;
    }
    const defaultH = this.defaultRowHeight;
    const target = hasContent ? Math.max(20, maxH) : defaultH;
    this.rowHeights[ri] = target;
    this.recomputeRowOffsets();
    this.updateViewport();
    this.queueSave();
  }
  onGlobalMouseMove(e: MouseEvent) {
    if (this.resizingCol) {
      const dx = e.clientX - this.resizingCol.startX;
      const w = Math.max(40, this.resizingCol.startW + dx);
      this.colWidths[this.resizingCol.index] = w;
    }
    if (this.resizingRow) {
      const dy = e.clientY - this.resizingRow.startY;
      const h = Math.max(20, this.resizingRow.startH + dy);
      this.rowHeights[this.resizingRow.index] = h;
      this.recomputeRowOffsets();
      this.updateViewport();
    }
  }
  endResizing() { if (this.resizingCol || this.resizingRow) { this.resizingCol = null; this.resizingRow = null; this.queueSave(); } }
  onMouseLeaveEditor() { this.dragging = false; }

  // Focus/scroll helpers
  private moveFocus(r: number, c: number) {
    r = Math.max(0, Math.min(this.grid.length - 1, r));
    c = Math.max(0, Math.min((this.grid[0]?.length || 1) - 1, c));
    this.activeCell = { r, c };
    this.ensureCellVisible(r, c);
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`input[data-rc="${r}-${c}"]`);
      el?.focus();
      if (el) { const len = el.value?.length ?? 0; try { el.setSelectionRange(len, len); } catch { /* ignore */ } }
    }, 0);
  }
  private ensureCellVisible(r: number, c: number) {
    const pane = this.editorMainPane?.nativeElement; if (!pane) return;
    // Vertical visibility
    const totalTop = this.rowOffsets[r] || 0; const h = this.rowHeights[r] || this.defaultRowHeight;
    const vTop = pane.scrollTop; const vBottom = vTop + pane.clientHeight;
    if (totalTop < vTop) pane.scrollTop = totalTop; else if ((totalTop + h) > vBottom) pane.scrollTop = totalTop + h - pane.clientHeight;
    // Horizontal visibility (approximate)
    let left = 40; // row header width
    for (let i = 0; i < c; i++) left += this.colWidths[i] || this.defaultColWidth;
    const cw = this.colWidths[c] || this.defaultColWidth;
    const hLeft = pane.scrollLeft; const hRight = hLeft + pane.clientWidth;
    if (left < hLeft) pane.scrollLeft = left; else if ((left + cw) > hRight) pane.scrollLeft = (left + cw) - pane.clientWidth;
    this.updateViewport();
  }

  // Persist sizes with data when saving
  private packData(){
    return { grid: this.grid, colWidths: this.colWidths, rowHeights: this.rowHeights };
  }

  // Measure helpers
  private measureCtx?: CanvasRenderingContext2D;
  private ensureMeasureCtx() {
    if (this.measureCtx) return this.measureCtx;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    // Try to pick up the font from a cell input if present
    let font = '';
    const el = document.querySelector('input[data-rc]') as HTMLInputElement | null;
    if (el) {
      const cs = getComputedStyle(el);
      font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`.trim();
    } else {
      font = 'normal 14px system-ui, Arial, sans-serif';
    }
    ctx.font = font;
    this.measureCtx = ctx; return ctx;
  }
  private measureText(text: string): number {
    const ctx = this.ensureMeasureCtx();
    // padding left+right (~16px) + a little buffer
    const base = ctx.measureText(String(text)).width;
    return Math.ceil(base + 20);
  }
  private measureTextHeight(text: string): number {
    // Approximate height based on line count and line-height from an input
    const ref = document.querySelector('input[data-rc]') as HTMLInputElement | null;
    const cs = ref ? getComputedStyle(ref) : null;
    const lineH = cs ? parseFloat(cs.lineHeight || '20') : 20;
    const paddingY = cs ? (parseFloat(cs.paddingTop||'4') + parseFloat(cs.paddingBottom||'4')) : 8;
    const lines = String(text).split(/\r?\n/).length;
    return Math.ceil(lines * lineH + paddingY);
  }
}
