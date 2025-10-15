import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SheetsService, SheetDoc, defaultGrid } from '../../sheets.service';

@Component({
  standalone: true,
  selector: 'app-sheet',
  imports: [CommonModule, FormsModule],
  templateUrl: './sheet.component.html'
})
export class SheetPageComponent implements OnInit {
  sheet: SheetDoc | null = null;
  grid: string[][] = defaultGrid();
  pendingSave?: any;

  constructor(private route: ActivatedRoute, private router: Router, public sheets: SheetsService) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') || 'new';
    this.sheet = { id, title: '', data: defaultGrid(), status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (id !== 'new') {
      const existing = this.sheets.get(id) || await this.sheets.fetch(id);
      if (existing) this.sheet = existing; else { this.router.navigate(['/']); return; }
    }
    this.grid = (this.sheet?.data as string[][]) || defaultGrid();
  }

  onTitleChange(){ this.queueSave(); }
  onCellChange(r: number, c: number, val: string){ if (!this.sheet) return; this.grid[r][c] = val; this.sheet.data = this.grid; this.queueSave(); }

  addRow(){ this.grid.push(Array.from({length: this.grid[0]?.length||10}, ()=>'') ); this.sheet!.data = this.grid; this.queueSave(); }
  addCol(){ for (const row of this.grid) row.push(''); this.sheet!.data = this.grid; this.queueSave(); }

  private queueSave(){ if (!this.sheet) return; if (this.pendingSave) clearTimeout(this.pendingSave); this.pendingSave = setTimeout(()=> this.save(), 400); }
  private async ensureCreatedId(){ if (this.sheet && this.sheet.id==='new') { const hasTitle = !!this.sheet.title && this.sheet.title.trim().length>0; const hasData = JSON.stringify(this.grid).length>2; if (hasTitle || hasData) { const created = await this.sheets.create({ title: this.sheet.title, data: this.grid }); this.sheet = created; this.router.navigate(['/sheet', created.id], { replaceUrl: true }); } } }
  private async save(){ if (!this.sheet) return; await this.ensureCreatedId(); if (!this.sheet) return; this.sheet.data = this.grid; await this.sheets.save(this.sheet); }

  colLabel(i: number): string { return String.fromCharCode(65 + (i % 26)); }

  trackRow = (_: number, __: string[]) => _;
  trackCol = (_: number, __: string) => _;

  onCellKeydown(e: KeyboardEvent, ri: number, ci: number) {
    if (e.key === 'Enter') { e.preventDefault(); }
  }
}
