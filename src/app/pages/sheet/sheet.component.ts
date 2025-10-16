import { Component, OnInit, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SheetsService, SheetDoc, defaultGrid } from '../../sheets.service';
type CellMeta = { align?: 'left'|'center'|'right', format?: 'text'|'number'|'date', numberPreset?: 'num0'|'num2'|'currencyUSD'|'percent', datePreset?: 'dateISO'|'dateMDY' };

@Component({
  standalone: true,
  selector: 'app-sheet',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './sheet.component.html'
})

export class SheetPageComponent implements OnInit, AfterViewInit {
  sheet: SheetDoc | null = null;
  grid: string[][] = defaultGrid();
  meta: (CellMeta | null)[][] = [];
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
      case 'rowAbove': { const [start] = this.getSelectedRowBounds() || [0,0]; this.insertRowAt(start); break; }
      case 'rowBelow': { const [,end] = this.getSelectedRowBounds() || [this.grid.length-1,this.grid.length-1]; this.insertRowAt(end+1); break; }
      case 'colLeft': { const [cstart] = this.getSelectedColBounds() || [0,0]; this.insertColAt(cstart); break; }
      case 'colRight': { const [,cend] = this.getSelectedColBounds() || [ (this.grid[0]?.length||0)-1, (this.grid[0]?.length||0)-1 ]; this.insertColAt(cend+1); break; }
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
      this.initMeta();
    } else if (data && Array.isArray(data.grid)) {
      this.grid = data.grid as string[][];
      this.colWidths = Array.isArray(data.colWidths) && data.colWidths.length ? data.colWidths.slice() : Array.from({ length: this.grid[0]?.length || 0 }, () => this.defaultColWidth);
      this.rowHeights = Array.isArray(data.rowHeights) && data.rowHeights.length ? data.rowHeights.slice() : Array.from({ length: this.grid.length }, () => this.defaultRowHeight);
      this.recomputeRowOffsets();
      this.meta = Array.isArray((data as any).meta) ? (data as any).meta : [];
      if (!this.meta.length) this.initMeta();
    } else {
      this.grid = defaultGrid();
      this.initSizing();
      this.initMeta();
    }
    this.updateViewport();
  }

  ngAfterViewInit(): void {
    // Attach scroll listener after view init
    setTimeout(() => {
      this.editorMainPane?.nativeElement?.addEventListener('scroll', () => this.updateViewport());
      window.addEventListener('mouseup', () => this.onGlobalMouseUp());
      window.addEventListener('mousemove', (e) => { this.onGlobalMouseMove(e); if (this.draggingFill) { this.updateFillPreview(e); } });
      window.addEventListener('mouseup', (e) => { if (this.draggingFill) this.applyFill(e); });
      this.headerHeight = this.headerRow?.nativeElement?.offsetHeight || this.headerHeight;
      window.addEventListener('resize', () => { this.headerHeight = this.headerRow?.nativeElement?.offsetHeight || this.headerHeight; });
      this.updateViewport();
    }, 0);
  }

  onTitleChange() { this.queueSave(); }
  onCellChange(r: number, c: number, val: string) { if (!this.sheet) return; this.grid[r][c] = val; this.sheet.data = this.packData(); this.queueSave(); }
  onCellInput(e: Event, r: number, c: number){ if (this.showFormatted) return; const val = (e.target as HTMLInputElement).value; this.onCellChange(r,c,val); }

  addRow() { this.grid.push(Array.from({ length: this.grid[0]?.length || 10 }, () => '')); this.meta.push(Array.from({ length: this.grid[0]?.length || 10 }, () => null)); this.rowHeights.push(this.defaultRowHeight); this.recomputeRowOffsets(); this.sheet!.data = this.packData(); this.queueSave(); }
  addCol() { for (let r=0; r<this.grid.length; r++){ this.grid[r].push(''); (this.meta[r] ||= []).push(null); } this.colWidths.push(this.defaultColWidth); this.sheet!.data = this.packData(); this.queueSave(); }

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
    // Clipboard shortcuts
    if ((e.ctrlKey || (e as any).metaKey)) {
      if (key.toLowerCase() === 'c') { e.preventDefault(); this.copySelection(); return; }
      if (key.toLowerCase() === 'x') { e.preventDefault(); this.cutSelection(); return; }
      // 'v' is handled via paste event so let it bubble
    }
    // Delete clears selected cells
    if (key === 'Delete' || key === 'Backspace') { if (!this.isEditingInput(e)) { e.preventDefault(); this.clearSelectionValues(); return; } }
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
    // Row/column selection shortcuts
    if (key === ' ' && e.shiftKey) { e.preventDefault(); this.selectRow(ri); }
    if (key === ' ' && ((e as any).ctrlKey || (e as any).metaKey)) { e.preventDefault(); this.selectColumn(ci); }
  }

  private isEditingInput(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
  }

  // Clipboard handling
  private async copySelection(){
    const text = this.serializeSelectionToText();
    try { await navigator.clipboard.writeText(text); } catch { this.fallbackCopy(text); }
  }
  private async cutSelection(){ this.copySelection(); this.clearSelectionValues(); }
  private serializeSelectionToText(): string {
    if (this.rangeStart && this.rangeEnd){
      const r1 = Math.min(this.rangeStart.r, this.rangeEnd.r);
      const r2 = Math.max(this.rangeStart.r, this.rangeEnd.r);
      const c1 = Math.min(this.rangeStart.c, this.rangeEnd.c);
      const c2 = Math.max(this.rangeStart.c, this.rangeEnd.c);
      const lines: string[] = [];
      for (let r=r1; r<=r2; r++){
        const row = [] as string[];
        for (let c=c1; c<=c2; c++) row.push(this.grid[r]?.[c] ?? '');
        lines.push(row.join('\t'));
      }
      return lines.join('\n');
    }
    if (this.multiSelected.size){
      const cells = Array.from(this.multiSelected).map(k=>k.split('-').map(n=>parseInt(n,10)) as [number,number]).sort((a,b)=> a[0]===b[0]? a[1]-b[1] : a[0]-b[0]);
      // Output as single column, one per line
      return cells.map(([r,c]) => this.grid[r]?.[c] ?? '').join('\n');
    }
    if (this.activeCell){ return String(this.grid[this.activeCell.r]?.[this.activeCell.c] ?? ''); }
    return '';
  }
  private fallbackCopy(text: string){ const ta = document.createElement('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} document.body.removeChild(ta); }
  onCellPaste(e: ClipboardEvent, ri: number, ci: number){
    const data = e.clipboardData?.getData('text/plain'); if (!data) return;
    e.preventDefault();
    const rows = data.split(/\r?\n/).map(line => line.split('\t'));
    // Multi-selection paste behavior
    if (this.multiSelected.size && rows.length === 1 && rows[0].length === 1){
      const val = rows[0][0];
      for (const k of Array.from(this.multiSelected)) { const [r,c]=k.split('-').map(n=>parseInt(n,10)); if (!Number.isNaN(r)&&!Number.isNaN(c)) this.grid[r][c] = val; }
      this.sheet!.data = this.packData(); this.queueSave(); return;
    }
    // Range or single-cell paste: fill starting at active cell or current ri,ci
    const startR = this.activeCell ? this.activeCell.r : ri;
    const startC = this.activeCell ? this.activeCell.c : ci;
    const maxR = this.grid.length;
    const maxC = this.grid[0]?.length || 0;
    for (let r=0; r<rows.length; r++){
      for (let c=0; c<rows[r].length; c++){
        const tr = startR + r, tc = startC + c;
        if (tr < maxR && tc < maxC) this.grid[tr][tc] = rows[r][c];
      }
    }
    this.sheet!.data = this.packData(); this.queueSave();
  }

  // Viewport virtualization
  @ViewChild('editorMainPane') editorMainPane?: ElementRef<HTMLDivElement>;
  @ViewChild('headerRow') headerRow?: ElementRef<HTMLTableRowElement>;
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
  headerHeight = 28;
  showFormatted = false;

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
  private findColAtOffset(offsetX: number): number {
    // offsetX is from left of first data column (after row header)
    let x = 0; const cols = this.colWidths.length;
    for (let i=0; i<cols; i++){ const w = this.colWidths[i] || this.defaultColWidth; if (x + w > offsetX) return i; x += w; }
    return Math.max(0, cols - 1);
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
  private initMeta(){ const rows = this.grid.length, cols = this.grid[0]?.length || 0; this.meta = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null)); }
  get selectionRect(): { x: number, y: number, w: number, h: number } | null {
    let r1: number, r2: number, c1: number, c2: number;
    if (this.rangeStart && this.rangeEnd){
      r1 = Math.min(this.rangeStart.r, this.rangeEnd.r);
      r2 = Math.max(this.rangeStart.r, this.rangeEnd.r);
      c1 = Math.min(this.rangeStart.c, this.rangeEnd.c);
      c2 = Math.max(this.rangeStart.c, this.rangeEnd.c);
    } else if (this.activeCell){ r1 = r2 = this.activeCell.r; c1 = c2 = this.activeCell.c; }
    else return null;
    // Resolve DOM elements for first and last cell in range
    const pane = this.editorMainPane?.nativeElement; if (!pane) return null;
    const a = document.querySelector<HTMLInputElement>(`input[data-rc="${r1}-${c1}"]`);
    const b = document.querySelector<HTMLInputElement>(`input[data-rc="${r2}-${c2}"]`);
    if (!a || !b) return null;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    const x = (ar.left - pr.left) + pane.scrollLeft - 1; // adjust for border
    const y = (ar.top - pr.top) + pane.scrollTop - 1;
    const w = (br.right - ar.left) + 2;
    const h = (br.bottom - ar.top) + 2;
    return { x, y, w, h };
  }
  private clearSelectionValues(){
    if (this.rangeStart && this.rangeEnd){
      const r1 = Math.min(this.rangeStart.r, this.rangeEnd.r);
      const r2 = Math.max(this.rangeStart.r, this.rangeEnd.r);
      const c1 = Math.min(this.rangeStart.c, this.rangeEnd.c);
      const c2 = Math.max(this.rangeStart.c, this.rangeEnd.c);
      for (let r=r1; r<=r2; r++) for (let c=c1; c<=c2; c++) this.grid[r][c] = '';
    } else if (this.multiSelected.size){
      for (const k of this.multiSelected){ const [r,c] = k.split('-').map(n=>parseInt(n,10)); if (!Number.isNaN(r)&&!Number.isNaN(c)) this.grid[r][c]=''; }
    } else if (this.activeCell){ this.grid[this.activeCell.r][this.activeCell.c] = ''; }
    this.sheet!.data = this.packData(); this.queueSave();
  }
  private getSelectedRowBounds(): [number, number] | null {
    // Determine selection from range, multi, or active cell
    let rows: number[] = [];
    if (this.rangeStart && this.rangeEnd) {
      const r1 = Math.min(this.rangeStart.r, this.rangeEnd.r);
      const r2 = Math.max(this.rangeStart.r, this.rangeEnd.r);
      rows = [r1, r2];
    } else if (this.multiSelected.size) {
      const set = new Set<number>();
      for (const k of this.multiSelected) { const r = parseInt(k.split('-')[0], 10); if (!Number.isNaN(r)) set.add(r); }
      const arr = Array.from(set.values()).sort((a,b)=>a-b);
      if (arr.length) rows = [arr[0], arr[arr.length-1]];
    } else if (this.activeCell) {
      rows = [this.activeCell.r, this.activeCell.r];
    }
    if (!rows.length) return null;
    const start = Math.max(0, Math.min(this.grid.length-1, rows[0]));
    const end = Math.max(0, Math.min(this.grid.length-1, rows[1]));
    return [Math.min(start,end), Math.max(start,end)];
  }
  private getSelectedColBounds(): [number, number] | null {
    let cols: number[] = [];
    if (this.rangeStart && this.rangeEnd) {
      const c1 = Math.min(this.rangeStart.c, this.rangeEnd.c);
      const c2 = Math.max(this.rangeStart.c, this.rangeEnd.c);
      cols = [c1, c2];
    } else if (this.multiSelected.size) {
      const set = new Set<number>();
      for (const k of this.multiSelected) { const c = parseInt(k.split('-')[1], 10); if (!Number.isNaN(c)) set.add(c); }
      const arr = Array.from(set.values()).sort((a,b)=>a-b);
      if (arr.length) cols = [arr[0], arr[arr.length-1]];
    } else if (this.activeCell) {
      cols = [this.activeCell.c, this.activeCell.c];
    }
    const maxC = Math.max(0, (this.grid[0]?.length||1)-1);
    if (!cols.length) return null;
    const start = Math.max(0, Math.min(maxC, cols[0]));
    const end = Math.max(0, Math.min(maxC, cols[1]));
    return [Math.min(start,end), Math.max(start,end)];
  }

  private insertRowAt(index: number){
    const cols = this.grid[0]?.length || 0;
    index = Math.max(0, Math.min(this.grid.length, index));
    this.grid.splice(index, 0, Array.from({ length: cols }, () => ''));
    this.meta.splice(index, 0, Array.from({ length: cols }, () => null));
    this.rowHeights.splice(index, 0, this.defaultRowHeight);
    this.recomputeRowOffsets();
    this.sheet!.data = this.packData();
    this.queueSave();
  }
  private insertColAt(index: number){
    const rows = this.grid.length;
    const maxC = this.grid[0]?.length || 0;
    index = Math.max(0, Math.min(maxC, index));
    for (let r = 0; r < rows; r++) { this.grid[r].splice(index, 0, ''); (this.meta[r] ||= []).splice(index, 0, null); }
    this.colWidths.splice(index, 0, this.defaultColWidth);
    this.sheet!.data = this.packData();
    this.queueSave();
  }

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
    return { grid: this.grid, colWidths: this.colWidths, rowHeights: this.rowHeights, meta: this.meta };
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

  // Formatting helpers for template
  cellAlign(r: number, c: number): 'left'|'center'|'right' { return (this.meta[r]?.[c]?.align as any) || 'left'; }
  cellInputType(r: number, c: number): 'text'|'number'|'date' { return (this.meta[r]?.[c]?.format as any) || 'text'; }
  formatDisplay(r: number, c: number, raw: any): string {
    const meta = this.meta[r]?.[c] || {} as any;
    const val = String(raw ?? '');
    if (!val) return '';
    if (meta.format === 'number'){
      const num = Number(val.replace(/,/g,'')); if (Number.isNaN(num)) return val;
      switch(meta.numberPreset){
        case 'num0': return Math.round(num).toLocaleString();
        case 'currencyUSD': return num.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
        case 'percent': return (num*100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%';
        case 'num2': default: return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }
    if (meta.format === 'date'){
      const d = new Date(val); if (isNaN(d.getTime())) return val;
      const yyyy = d.getFullYear(); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
      if (meta.datePreset === 'dateMDY') return `${mm}/${dd}/${yyyy}`;
      return `${yyyy}-${mm}-${dd}`;
    }
    return val;
  }

  // Fill handle state
  draggingFill = false;
  fillPreviewRect: { x:number,y:number,w:number,h:number } | null = null;
  private fillFrom: { r1:number,c1:number,r2:number,c2:number } | null = null;
  startFillDrag(e: MouseEvent){ e.preventDefault(); e.stopPropagation(); if (!this.selectionRect || !(this.rangeStart||this.activeCell)) return; const rs = this.rangeStart || this.activeCell!; const re = this.rangeEnd || this.activeCell!; this.fillFrom = { r1: Math.min(rs.r, re.r), c1: Math.min(rs.c, re.c), r2: Math.max(rs.r, re.r), c2: Math.max(rs.c, re.c) }; this.draggingFill = true; }
  private updateFillPreview(e: MouseEvent){ if (!this.draggingFill || !this.fillFrom) return; const pane = this.editorMainPane?.nativeElement; if (!pane) return; const pr = pane.getBoundingClientRect(); const relX = pane.scrollLeft + (e.clientX - pr.left) - 40; const relY = pane.scrollTop + (e.clientY - pr.top) - (this.headerHeight||28); const tr = this.findRowAtOffset(Math.max(0, relY)); const tc = this.findColAtOffset(Math.max(0, relX)); const r1 = Math.min(this.fillFrom.r1, tr); const r2 = Math.max(this.fillFrom.r2, tr); const c1 = Math.min(this.fillFrom.c1, tc); const c2 = Math.max(this.fillFrom.c2, tc); const a = document.querySelector<HTMLInputElement>(`input[data-rc="${r1}-${c1}"]`); const b=document.querySelector<HTMLInputElement>(`input[data-rc=\"${r2}-${c2}\"]`); const paneRect = pr; if (a && b){ const ar=a.getBoundingClientRect(); const br=b.getBoundingClientRect(); this.fillPreviewRect={ x:(ar.left-paneRect.left)+pane.scrollLeft-1, y:(ar.top-paneRect.top)+pane.scrollTop-1, w:(br.right-ar.left)+2, h:(br.bottom-ar.top)+2 }; } }
  private applyFill(e: MouseEvent){ if (!this.fillFrom) return; const pane=this.editorMainPane?.nativeElement; if (!pane) return; const pr=pane.getBoundingClientRect(); const relX = pane.scrollLeft + (e.clientX - pr.left) - 40; const relY = pane.scrollTop + (e.clientY - pr.top) - (this.headerHeight||28); const tr = this.findRowAtOffset(Math.max(0, relY)); const tc = this.findColAtOffset(Math.max(0, relX)); const src = this.fillFrom; const dr1 = Math.min(src.r1, tr), dr2 = Math.max(src.r2, tr), dc1 = Math.min(src.c1, tc), dc2 = Math.max(src.c2, tc); this.performFill(src, { r1:dr1,c1:dc1,r2:dr2,c2:dc2 }); this.draggingFill=false; this.fillFrom=null; this.fillPreviewRect=null; this.queueSave(); }
  private performFill(src: {r1:number,c1:number,r2:number,c2:number}, dst: {r1:number,c1:number,r2:number,c2:number}){
    // Determine expanded area outside src to fill
    const top = Math.min(dst.r1, src.r1), left = Math.min(dst.c1, src.c1), bottom = Math.max(dst.r2, src.r2), right = Math.max(dst.c2, src.c2);
    const fillTop = top < src.r1 ? top : src.r2+1;
    const fillBottom = bottom > src.r2 ? bottom : src.r1-1;
    const fillLeft = left < src.c1 ? left : src.c2+1;
    const fillRight = right > src.c2 ? right : src.c1-1;
    const sh = src.r2 - src.r1 + 1, sw = src.c2 - src.c1 + 1;
    const isSingle = sh===1 && sw===1;
    const srcVal = this.grid[src.r1][src.c1];
    const incType = isSingle ? this.detectIncrementType(srcVal) : 'none';
    for (let r=top; r<=bottom; r++){
      for (let c=left; c<=right; c++){
        const inSrc = r>=src.r1 && r<=src.r2 && c>=src.c1 && c<=src.c2;
        if (inSrc) continue; // skip original
        const inFill = (r>=fillTop && r<=fillBottom && c>=src.c1 && c<=src.c2) || (c>=fillLeft && c<=fillRight && r>=src.r1 && r<=src.r2);
        if (!inFill) continue;
        if (incType!=='none') {
          // Increment along the axis of expansion
          const dr = r - src.r1; const dc = c - src.c1;
          const step = (r>src.r2 || c>src.c2) ? 1 : -1;
          this.grid[r][c] = this.incrementValue(srcVal, (dr+dc)*step, incType);
        } else {
          // Pattern copy
          const sr = src.r1 + ((r - top) % sh + sh) % sh;
          const sc = src.c1 + ((c - left) % sw + sw) % sw;
          this.grid[r][c] = this.grid[sr][sc];
        }
      }
    }
    this.sheet!.data = this.packData();
  }
  private detectIncrementType(val: string): 'number'|'letter'|'date'|'none' {
    if (/^-?\d+(?:\.\d+)?$/.test(val)) return 'number';
    if (/^[A-Za-z]$/.test(val)) return 'letter';
    const d = new Date(val); if (!isNaN(d.getTime())) return 'date';
    return 'none';
  }
  private incrementValue(val: string, steps: number, type: 'number'|'letter'|'date'): string {
    if (type==='number'){ const n = parseFloat(val); const out = n + steps; return String(out); }
    if (type==='letter'){ const code = val.charCodeAt(0); const base = code>=97?97:65; const offset = (code - base + steps) % 26; return String.fromCharCode(base + (offset<0?offset+26:offset)); }
    if (type==='date'){ const d = new Date(val); d.setDate(d.getDate()+steps); const yyyy=d.getFullYear(); const mm=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${yyyy}-${mm}-${dd}`; }
    return val;
  }

  // Context menu
  contextOpen = false;
  contextX = 0; contextY = 0;
  contextTarget: { type: 'cell'|'row'|'col', r?: number, c?: number } | null = null;
  contextItems: { divider?: boolean, label?: string, key?: string, children?: { label: string, key: string }[] }[] = [];
  submenu: { x: number, y: number, items: { label: string, key: string }[] } | null = null;

  openContext(e: MouseEvent, type: 'cell'|'row'|'col', r?: number, c?: number){
    e.preventDefault();
    this.contextTarget = { type, r, c };
    // Update selection to reflect context target for clarity
    if (type === 'row' && typeof r === 'number') this.selectRow(r);
    if (type === 'col' && typeof c === 'number') this.selectColumn(c);
    if (type === 'cell' && typeof r === 'number' && typeof c === 'number'){
      this.activeCell = { r, c }; this.rangeStart = { r, c }; this.rangeEnd = { r, c };
    }
    this.buildContextItems();
    const vw = window.innerWidth, vh = window.innerHeight;
    const menuW = 220, menuH = 260;
    let x = e.clientX, y = e.clientY;
    if (x + menuW > vw) x = Math.max(8, vw - menuW - 8);
    if (y + menuH > vh) y = Math.max(8, vh - menuH - 8);
    this.contextX = x; this.contextY = y; this.contextOpen = true;
  }
  closeContext(){ this.contextOpen = false; this.contextItems = []; this.contextTarget = null; }
  private buildContextItems(){
    const items: { divider?: boolean, label?: string, key?: string, children?: { label: string, key: string }[] }[] = [];
    if (!this.contextTarget) { this.contextItems = []; return; }
    const t = this.contextTarget.type;
    if (t === 'cell' || t === 'row'){
      items.push({ label: 'Insert row above', key: 'insertRowAbove' });
      items.push({ label: 'Insert row below', key: 'insertRowBelow' });
      items.push({ label: 'Delete row(s)', key: 'deleteRows' });
      items.push({ label: 'Duplicate row', key: 'dupRow' });
      if (t === 'row'){
        items.push({ divider: true });
        items.push({ label: 'Row: Format as text', key: 'rowFmtText' });
        items.push({ label: 'Row: Format as number', key: 'rowFmtNumber' });
        items.push({ label: 'Row: Format as date', key: 'rowFmtDate' });
        items.push({ divider: true });
        items.push({ label: 'Row: Align left', key: 'rowAlignLeft' });
        items.push({ label: 'Row: Align center', key: 'rowAlignCenter' });
        items.push({ label: 'Row: Align right', key: 'rowAlignRight' });
      }
    }
    if (t === 'cell' || t === 'col'){
      items.push({ label: 'Insert column left', key: 'insertColLeft' });
      items.push({ label: 'Insert column right', key: 'insertColRight' });
      items.push({ label: 'Delete column(s)', key: 'deleteCols' });
      items.push({ label: 'Duplicate column', key: 'dupCol' });
      if (t === 'col'){
        items.push({ divider: true });
        items.push({ label: 'Column: Format as text', key: 'colFmtText' });
        items.push({ label: 'Column: Format as number', key: 'colFmtNumber' });
        items.push({ label: 'Column: Format as date', key: 'colFmtDate' });
        items.push({ divider: true });
        items.push({ label: 'Column: Align left', key: 'colAlignLeft' });
        items.push({ label: 'Column: Align center', key: 'colAlignCenter' });
        items.push({ label: 'Column: Align right', key: 'colAlignRight' });
      }
    }
    if (t === 'cell'){
      items.push({ divider: true });
      items.push({ label: 'Format as text', key: 'fmtText' });
      items.push({ label: 'Format as number', key: 'fmtNumber' });
      items.push({ label: 'Format as date', key: 'fmtDate' });
      items.push({ label: 'Number format', key: 'numSub', children: [
        { label: '0 decimals', key: 'num0' },
        { label: '2 decimals', key: 'num2' },
        { label: 'Currency (USD)', key: 'currencyUSD' },
        { label: 'Percent', key: 'percent' },
      ]});
      items.push({ label: 'Date format', key: 'dateSub', children: [
        { label: 'YYYY-MM-DD', key: 'dateISO' },
        { label: 'MM/DD/YYYY', key: 'dateMDY' },
      ]});
      items.push({ divider: true });
      items.push({ label: 'Align left', key: 'alignLeft' });
      items.push({ label: 'Align center', key: 'alignCenter' });
      items.push({ label: 'Align right', key: 'alignRight' });
    }
    this.contextItems = items;
  }
  openSubmenu(item: any, ev: MouseEvent){ if (!item || !item.children) { this.submenu=null; return; } const parent = (ev.target as HTMLElement).closest('button') as HTMLElement; if (!parent) return; const pr = parent.getBoundingClientRect(); const pane = document.body.getBoundingClientRect(); this.submenu = { x: (pr.right - pane.left) - this.contextX + 10, y: (pr.top - pane.top) - this.contextY, items: item.children };
  }
  maybeCloseSubmenu(_e: MouseEvent){ /* keep submenu open while moving into it */ }
  onContextAction(item: { divider?: boolean, label?: string, key?: string }){
    const t = this.contextTarget;
    if (!t) return;
    const rowIndexFor = (pos: 'above'|'below') => {
      if (t.r != null) return pos==='above'? t.r : t.r+1;
      const b = this.getSelectedRowBounds(); if (!b) return pos==='above'? 0 : this.grid.length;
      return pos==='above'? b[0] : b[1]+1;
    };
    const colIndexFor = (pos: 'left'|'right') => {
      if (t.c != null) return pos==='left'? t.c : t.c+1;
      const b = this.getSelectedColBounds(); if (!b) return pos==='left'? 0 : (this.grid[0]?.length||0);
      return pos==='left'? b[0] : b[1]+1;
    };
    switch(item.key){
      case 'insertRowAbove': this.insertRowAt(rowIndexFor('above')); break;
      case 'insertRowBelow': this.insertRowAt(rowIndexFor('below')); break;
      case 'insertColLeft': this.insertColAt(colIndexFor('left')); break;
      case 'insertColRight': this.insertColAt(colIndexFor('right')); break;
      case 'deleteRows': this.deleteSelectedRows(); break;
      case 'deleteCols': this.deleteSelectedCols(); break;
      case 'rowFmtText': if (t.r!=null) this.applyFormatToRow(t.r,'text'); break;
      case 'rowFmtNumber': if (t.r!=null) this.applyFormatToRow(t.r,'number'); break;
      case 'rowFmtDate': if (t.r!=null) this.applyFormatToRow(t.r,'date'); break;
      case 'rowAlignLeft': if (t.r!=null) this.applyAlignToRow(t.r,'left'); break;
      case 'rowAlignCenter': if (t.r!=null) this.applyAlignToRow(t.r,'center'); break;
      case 'rowAlignRight': if (t.r!=null) this.applyAlignToRow(t.r,'right'); break;
      case 'colFmtText': if (t.c!=null) this.applyFormatToCol(t.c,'text'); break;
      case 'colFmtNumber': if (t.c!=null) this.applyFormatToCol(t.c,'number'); break;
      case 'colFmtDate': if (t.c!=null) this.applyFormatToCol(t.c,'date'); break;
      case 'colAlignLeft': if (t.c!=null) this.applyAlignToCol(t.c,'left'); break;
      case 'colAlignCenter': if (t.c!=null) this.applyAlignToCol(t.c,'center'); break;
      case 'colAlignRight': if (t.c!=null) this.applyAlignToCol(t.c,'right'); break;
      case 'dupRow': {
        const target = (t.r != null) ? t.r : (this.getSelectedRowBounds()?.[0] ?? 0);
        const src = this.grid[target]; if (!src) break;
        const copy = src.slice(); this.grid.splice(target+1, 0, copy);
        // Duplicate meta row
        const msrc = this.meta[target] || Array.from({ length: this.grid[0]?.length||0 }, () => null);
        this.meta.splice(target+1, 0, msrc.map(x => x ? { ...x } : null));
        this.rowHeights.splice(target+1, 0, this.rowHeights[target]||this.defaultRowHeight);
        this.recomputeRowOffsets(); this.sheet!.data = this.packData(); this.queueSave();
        break;
      }
      case 'dupCol': {
        const target = (t.c != null) ? t.c : (this.getSelectedColBounds()?.[0] ?? 0);
        for (let r=0; r<this.grid.length; r++){
          const val = this.grid[r]?.[target] ?? '';
          this.grid[r].splice(target+1, 0, val);
          const m = (this.meta[r] ||= []); const mv = m[target] || null; m.splice(target+1, 0, mv ? { ...mv } : null);
        }
        this.colWidths.splice(target+1, 0, this.colWidths[target]||this.defaultColWidth);
        this.sheet!.data = this.packData(); this.queueSave();
        break;
      }
      case 'fmtDate': this.applyFormatToSelection('date'); break;
      case 'fmtNumber': this.applyFormatToSelection('number'); break;
      case 'fmtText': this.applyFormatToSelection('text'); break;
      case 'num0': this.applyNumberPresetToSelection('num0'); break;
      case 'num2': this.applyNumberPresetToSelection('num2'); break;
      case 'currencyUSD': this.applyNumberPresetToSelection('currencyUSD'); break;
      case 'percent': this.applyNumberPresetToSelection('percent'); break;
      case 'dateISO': this.applyDatePresetToSelection('dateISO'); break;
      case 'dateMDY': this.applyDatePresetToSelection('dateMDY'); break;
      case 'alignLeft': this.applyAlignToSelection('left'); break;
      case 'alignCenter': this.applyAlignToSelection('center'); break;
      case 'alignRight': this.applyAlignToSelection('right'); break;
      default: break;
    }
    this.closeContext();
  }

  private applyAlignToSelection(align: 'left'|'center'|'right'){
    this.forEachSelectedCell((r,c) => { const m = (this.meta[r] ||= []); m[c] = { ...(m[c]||{}), align }; });
    this.sheet!.data = this.packData(); this.queueSave();
  }
  private applyFormatToSelection(format: 'text'|'number'|'date'){
    this.forEachSelectedCell((r,c) => { const m = (this.meta[r] ||= []); m[c] = { ...(m[c]||{}), format }; });
    this.sheet!.data = this.packData(); this.queueSave();
  }
  private applyNumberPresetToSelection(preset: 'num0'|'num2'|'currencyUSD'|'percent'){
    this.forEachSelectedCell((r,c) => { const m = (this.meta[r] ||= []); m[c] = { ...(m[c]||{}), format: 'number', numberPreset: preset }; });
    this.sheet!.data = this.packData(); this.queueSave();
  }
  private applyDatePresetToSelection(preset: 'dateISO'|'dateMDY'){
    this.forEachSelectedCell((r,c) => { const m = (this.meta[r] ||= []); m[c] = { ...(m[c]||{}), format: 'date', datePreset: preset }; });
    this.sheet!.data = this.packData(); this.queueSave();
  }
  private forEachSelectedCell(fn: (r:number,c:number)=>void){
    if (this.rangeStart && this.rangeEnd){
      const r1 = Math.min(this.rangeStart.r, this.rangeEnd.r);
      const r2 = Math.max(this.rangeStart.r, this.rangeEnd.r);
      const c1 = Math.min(this.rangeStart.c, this.rangeEnd.c);
      const c2 = Math.max(this.rangeStart.c, this.rangeEnd.c);
      for (let r=r1; r<=r2; r++) for (let c=c1; c<=c2; c++) fn(r,c);
      return;
    }
    if (this.multiSelected.size){
      for (const k of this.multiSelected){ const [rs, cs] = k.split('-').map(n=>parseInt(n,10)); if (!Number.isNaN(rs)&&!Number.isNaN(cs)) fn(rs,cs); }
      return;
    }
    if (this.activeCell){ fn(this.activeCell.r, this.activeCell.c); }
  }
  private applyAlignToRow(ri: number, align: 'left'|'center'|'right'){ for (let c=0; c<(this.grid[ri]?.length||0); c++){ const m=(this.meta[ri] ||= []); m[c] = { ...(m[c]||{}), align }; } this.sheet!.data=this.packData(); this.queueSave(); }
  private applyAlignToCol(ci: number, align: 'left'|'center'|'right'){ for (let r=0; r<this.grid.length; r++){ const m=(this.meta[r] ||= []); m[ci] = { ...(m[ci]||{}), align }; } this.sheet!.data=this.packData(); this.queueSave(); }
  private applyFormatToRow(ri: number, format: 'text'|'number'|'date'){ for (let c=0; c<(this.grid[ri]?.length||0); c++){ const m=(this.meta[ri] ||= []); m[c] = { ...(m[c]||{}), format }; } this.sheet!.data=this.packData(); this.queueSave(); }
  private applyFormatToCol(ci: number, format: 'text'|'number'|'date'){ for (let r=0; r<this.grid.length; r++){ const m=(this.meta[r] ||= []); m[ci] = { ...(m[ci]||{}), format }; } this.sheet!.data=this.packData(); this.queueSave(); }
  private deleteSelectedRows(){
    const b = this.getSelectedRowBounds(); if (!b) return;
    const [start,end] = b; const count = end-start+1;
    if (count<=0) return;
    this.grid.splice(start, count);
    this.rowHeights.splice(start, count);
    this.meta.splice(start, count);
    if (!this.grid.length){ this.grid = defaultGrid(); this.initSizing(); this.initMeta(); }
    this.recomputeRowOffsets(); this.sheet!.data = this.packData(); this.queueSave();
  }
  private deleteSelectedCols(){
    const b = this.getSelectedColBounds(); if (!b) return;
    const [start,end] = b; const count = end-start+1;
    if (count<=0) return;
    for (let r=0; r<this.grid.length; r++){
      this.grid[r].splice(start, count);
      (this.meta[r] ||= []).splice(start, count);
    }
    this.colWidths.splice(start, count);
    if (!(this.grid[0]?.length)){ this.grid = defaultGrid(); this.initSizing(); this.initMeta(); }
    this.sheet!.data = this.packData(); this.queueSave();
  }
}
